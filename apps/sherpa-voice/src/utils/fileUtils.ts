/**
 * Cross-platform file reading utilities.
 *
 * On web, we use fetch() because expo-file-system is not available.
 * On native, we use expo-file-system with Base64 decoding.
 */
import { Platform } from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { baseLogger } from '../config';

const logger = baseLogger.extend('fileUtils');

/** Normalize a URI so it's fetchable on web or readable by expo-file-system on native. */
function toNativeUri(uri: string): string {
  if (uri.startsWith('file://') || uri.startsWith('http')) return uri;
  return `file://${uri}`;
}

/**
 * Read a file as ArrayBuffer.
 * On web: fetch the URL.
 * On native: read as Base64, decode to ArrayBuffer.
 */
export async function readFileAsArrayBuffer(uri: string): Promise<ArrayBuffer> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Failed to fetch ${uri}: ${response.status}`);
    return response.arrayBuffer();
  }
  const expoUri = toNativeUri(uri);
  const base64 = await FileSystem.readAsStringAsync(expoUri, {
    encoding: FileSystem.EncodingType.Base64,
  });
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer;
}

/**
 * Read a file as a UTF-8 string.
 * On web: fetch the URL.
 * On native: use FileSystem.readAsStringAsync (UTF-8).
 */
export async function readFileAsText(uri: string): Promise<string> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) throw new Error(`Failed to fetch ${uri}: ${response.status}`);
    // Expo's SPA fallback returns HTML for missing files — detect and reject
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('text/html')) {
      throw new Error(`Expected text file but got HTML for ${uri} (SPA fallback?)`);
    }
    return response.text();
  }
  return FileSystem.readAsStringAsync(toNativeUri(uri));
}

/**
 * Check if a file/directory exists.
 * On web: HEAD request (falls back to GET on error).
 * On native: FileSystem.getInfoAsync.
 */
export async function fileExists(uri: string): Promise<boolean> {
  if (Platform.OS === 'web') {
    try {
      const r = await fetch(uri, { method: 'HEAD' });
      if (!r.ok) return false;
      // Expo SPA fallback returns 200 + text/html for missing files
      const ct = r.headers.get('content-type') || '';
      return !ct.includes('text/html');
    } catch {
      return false;
    }
  }
  const info = await FileSystem.getInfoAsync(toNativeUri(uri));
  return info.exists;
}

/**
 * Size of a file in bytes, or 0 when it is missing.
 * On web: fetch the URL and measure the body (getInfoAsync is not available).
 * On native: FileSystem.getInfoAsync.
 */
export async function getFileSize(uri: string): Promise<number> {
  if (Platform.OS === 'web') {
    const response = await fetch(uri);
    if (!response.ok) return 0;
    return (await response.blob()).size;
  }
  const info = await FileSystem.getInfoAsync(uri);
  return info.exists ? info.size : 0;
}

/**
 * Resolve the effective model directory path.
 * Sherpa-onnx tarballs extract into a `sherpa-onnx-*` subdirectory — descend
 * into it automatically when the ONNX files live there.
 */
export async function resolveModelDir(rawPath: string): Promise<string> {
  let cleanPath = rawPath.replace(/^file:\/\//, '');
  try {
    const dirContents = await FileSystem.readDirectoryAsync(rawPath);
    logger.info(`resolveModelDir: ${rawPath} contents: [${dirContents.join(', ')}]`);

    for (const entry of dirContents) {
      const subPath = `${rawPath}/${entry}`;
      const subInfo = await FileSystem.getInfoAsync(subPath);
      if (!subInfo.exists || !subInfo.isDirectory) continue;
      if (!entry.includes('sherpa-onnx')) continue;

      const subContents = await FileSystem.readDirectoryAsync(subPath);
      if (subContents.some((f) => f.endsWith('.onnx') || f === 'tokens.txt')) {
        cleanPath = `${cleanPath}/${entry}`;
        logger.info(`resolveModelDir: descending into subdirectory → ${cleanPath}`);
        return cleanPath;
      }
    }

    // Some model directories contain one extracted subdirectory plus the original
    // archive. Descend into the extracted folder when it is the only directory
    // and it already exposes model files.
    const directories: string[] = [];
    for (const entry of dirContents) {
      const subInfo = await FileSystem.getInfoAsync(`${rawPath}/${entry}`);
      if (subInfo.exists && subInfo.isDirectory) {
        directories.push(entry);
      }
    }
    if (directories.length === 1) {
      const onlyDir = directories[0];
      const subPath = `${rawPath}/${onlyDir}`;
      const subContents = await FileSystem.readDirectoryAsync(subPath);
      if (subContents.some((f) => f.endsWith('.onnx') || f === 'tokens.txt')) {
        cleanPath = `${cleanPath}/${onlyDir}`;
        logger.info(`resolveModelDir: descending into only subdirectory → ${cleanPath}`);
      }
    }
  } catch (e) {
    logger.warn(`resolveModelDir: failed to read ${rawPath}: ${e}`);
  }
  return cleanPath;
}
