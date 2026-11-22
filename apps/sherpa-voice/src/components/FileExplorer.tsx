import React, { useEffect, useState, useCallback, useMemo } from 'react';
import {
  ActivityIndicator,
  FlatList,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Platform,
  Alert
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as FileSystem from 'expo-file-system/legacy';
import * as Clipboard from 'expo-clipboard';
import { formatBytes } from '../utils/formatters';
import { useModelManagement } from '../contexts/ModelManagement/ModelManagementContext';
import { baseLogger } from '../config';

const logger = baseLogger.extend('FileExplorer');

interface FileItem {
  name: string;
  isDirectory: boolean;
  path: string;
  size?: number;
  uri?: string;
  modelId?: string;
  description?: string;
  displayPath?: string;
  modelType?: string;
  error?: string;
  exists?: boolean;
  modificationTime?: string;
  state?: string;
}

interface FileExplorerProps {
  currentPath: string;
  onNavigate: (path: string) => void;
  filterType: string;
  initialModelPath: string | null;
  onBackToDownloads?: () => void;
}

// Normalize paths (remove trailing slash) - Keep it simple
function normalizePath(path: string | null | undefined): string {
  if (!path) return '';
  return path.replace(/\/$/, '');
}

// Get normalized document directory once (remove trailing slash)
const normalizedDocumentDirectory = normalizePath(FileSystem.documentDirectory);

export function FileExplorer({
  currentPath: rawCurrentPath,
  onNavigate,
  filterType,
  initialModelPath,
  onBackToDownloads
}: FileExplorerProps) {
  const { getDownloadedModels } = useModelManagement();
  const [items, setItems] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showDebugInfo, setShowDebugInfo] = useState(false);
  const [debugItems, setDebugItems] = useState<FileItem[]>([]);

  // Memoize normalized paths derived from props to stabilize dependencies
  const currentPath = useMemo(() => normalizePath(rawCurrentPath), [rawCurrentPath]);
  const modelRootPath = useMemo(() => normalizePath(initialModelPath), [initialModelPath]);

  // Effect to handle initial path setting when initialModelPath changes.
  // Must NOT depend on currentPath — that would reset navigation every time the user
  // drills into a subdirectory (currentPath changes → effect re-runs → resets to root).
  useEffect(() => {
    const targetPath = initialModelPath ? modelRootPath : '';
    onNavigate(targetPath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialModelPath, modelRootPath]); // intentionally omit onNavigate (stable setState) and currentPath

  const fetchItems = useCallback(async (logOnly = false) => {
    // Use the memoized normalized currentPath directly for fetching logic
    const pathForFetch = currentPath;
    const prefix = logOnly ? 'DEBUG' : 'UI';

    // Safety check (though currentPath should be stable now)
    if (pathForFetch === null || pathForFetch === undefined) { // Check the derived path
      logger.warn(`fetchItems (${prefix}): Skipping fetch, derived currentPath is null/undefined.`);
      if (!logOnly) setLoading(false);
      return;
    }

    logger.info(`fetchItems (${prefix}): Starting fetch for "${pathForFetch}"`);

    if (!logOnly) {
      setLoading(true);
      setError(null);
      setItems([]); // Clear items immediately for UI fetch
    }

    try {
      // --- Explicit Path Type Check ---
      let pathType: 'virtual' | 'real' | 'invalid' = 'invalid';

      // Check 1: Is it the virtual root?
      if (pathForFetch === '') {
        pathType = 'virtual';
      }
      // Check 2: Does it look like a real path?
      // Use || because one source might provide file://, the other might not.
      else if (pathForFetch.startsWith(normalizedDocumentDirectory) || pathForFetch.startsWith('file://')) {
        pathType = 'real';
      }
      // Else: It's not virtual root and doesn't look like a known real path format

      if (!logOnly) {
        logger.info(`fetchItems (UI): path="${pathForFetch}", type=${pathType}`);
      }
      // --- End Explicit Path Type Check ---


      // Case 1: Real file system path
      if (pathType === 'real') {
        logger.info(`fetchItems (${prefix}): Handling as REAL path: ${pathForFetch}`);

        // --- Filesystem operations ---
        let pathInfo: FileSystem.FileInfo | null = null;
         try {
           pathInfo = await FileSystem.getInfoAsync(pathForFetch);

           if (!pathInfo.exists) throw new Error(`Path does not exist.`);
           if (!pathInfo.isDirectory) throw new Error(`Path is a file, not a directory.`);

         } catch (e) {
           const infoError = e instanceof Error ? e : new Error(String(e));
           const errorMsg = `getInfoAsync failed for ${pathForFetch}: ${infoError.message}`;
           logger.error(`fetchItems (${prefix}): ${errorMsg}`);
           if (!logOnly) setError(errorMsg);
           setItems([]);
           return; // Stop processing
         }

         let fileList: string[] = [];
         try {
           fileList = await FileSystem.readDirectoryAsync(pathForFetch);
         } catch (e) {
           const readDirError = e instanceof Error ? e : new Error(String(e));
           const errorMsg = `readDirectoryAsync failed for ${pathForFetch}: ${readDirError.message}`;
           logger.error(`fetchItems (${prefix}): ${errorMsg}`);
           if (!logOnly) setError(errorMsg);
           setItems([]);
           return; // Stop processing
         }

         const itemsWithInfoPromises = fileList.map(async (name) => {
           const itemPath = `${pathForFetch}/${name}`;
           try {
             const info = await FileSystem.getInfoAsync(itemPath);
             if (!info.exists) {
                 logger.warn(`fetchItems (${prefix}): Item ${name} reported but doesn't exist at ${itemPath}`);
                 return { name, path: itemPath, displayPath: itemPath.replace(/^file:\/\//, ''), isDirectory: false, exists: false, error: 'Reported but doesn\'t exist' };
             }
             return {
               name, path: itemPath, displayPath: itemPath.replace(/^file:\/\//, ''),
               isDirectory: info.isDirectory ?? false,
               size: info.isDirectory ? undefined : info.size,
               uri: info.uri, exists: info.exists,
             };
           } catch (itemError) {
             logger.error(`fetchItems (${prefix}): Error getting info for ${itemPath}: ${itemError instanceof Error ? itemError.message : String(itemError)}`);
             return { name, path: itemPath, displayPath: itemPath.replace(/^file:\/\//, ''), isDirectory: false, exists: false, error: `Failed to get info: ${String(itemError)}` };
           }
         });

         const itemsWithInfo = await Promise.all(itemsWithInfoPromises);
         const validItems = itemsWithInfo.filter(item => item.exists);

         if (!logOnly) {
           setItems(validItems as FileItem[]);
           logger.info(`fetchItems (${prefix}): Set ${validItems.length} valid items for UI.`);
         } else {
           logger.info(`fetchItems (${prefix}): Debug - Found ${validItems.length} valid items.`);
         }
         // --- End Filesystem operations ---
      }
      // Case 2: Virtual root
      else if (pathType === 'virtual') {
        logger.info(`fetchItems (${prefix}): Handling as VIRTUAL root.`);
        const downloadedModels = getDownloadedModels();
        const filteredModels = filterType === 'all'
           ? downloadedModels
           : downloadedModels.filter(model => model.metadata.type === filterType);

        if (filteredModels.length === 0) {
           const msg = 'No downloaded models found matching the filter.';
           logger.info(`fetchItems (${prefix}): ${msg}`);
           if (!logOnly) setError(msg);
           setItems([]);
         } else {
           const modelItems: FileItem[] = filteredModels
             .filter(model => model.localPath)
             .map(model => ({
               name: model.metadata.name, isDirectory: true,
               path: normalizePath(model.localPath!), // Use normalized path
               displayPath: model.localPath!.replace(/^file:\/\//, ''),
               modelId: model.metadata.id, description: model.metadata.description,
               modelType: model.metadata.type, size: undefined, exists: true,
             }));
           if (!logOnly) {
               setItems(modelItems);
               logger.info(`fetchItems (${prefix}): Set ${modelItems.length} model items for UI.`);
           } else {
               logger.info(`fetchItems (${prefix}): Debug - Found ${modelItems.length} model items.`);
           }
         }
      }
      // Case 3: Invalid/Unhandled path
      else { // pathType === 'invalid'
         const errorMsg = `Invalid or unhandled path state: "${pathForFetch}"`;
         logger.error(`fetchItems (${prefix}): ${errorMsg}`);
         if (!logOnly) setError(errorMsg);
         setItems([]);
      }
    } catch (error) {
      const errorMsg = `Error in fetchItems for ${pathForFetch}: ${error instanceof Error ? error.message : String(error)}`;
      logger.error(`fetchItems (${prefix}): Caught top-level error - ${errorMsg}`);
      if (!logOnly) setError(errorMsg);
      setItems([]);
    } finally {
      if (!logOnly) {
          setLoading(false);
      }
      logger.info(`fetchItems (${prefix}): Fetch finished for path: "${pathForFetch}"`);
    }
  }, [currentPath, filterType, getDownloadedModels]); // Depend on memoized path, filter, getter

  // Effect to trigger fetch when currentPath or filterType changes
  useEffect(() => {
    logger.info(`Fetch Effect: Triggered. currentPath="${currentPath}"`);
    // No need to check for null/undefined here if currentPath is derived via useMemo from prop
    fetchItems();
  }, [fetchItems, currentPath]); // Depend on callback and currentPath

  const logDirectoryContents = useCallback(async () => {
    setLoading(true);
    try {
      // Use a temporary array to hold debug items
      const tempDebugItems: FileItem[] = [];

      // Determine path type
      let pathType: 'virtual' | 'real' | 'invalid' = 'invalid';

      if (currentPath === '') {
        pathType = 'virtual';
      } else if (currentPath.startsWith(normalizedDocumentDirectory) || currentPath.startsWith('file://')) {
        pathType = 'real';
      }

      // Log path type info
      logger.info(`Debug Info: Path Type for "${currentPath}": ${pathType}`);

      if (pathType === 'real') {
        // Check path exists
        const pathInfo = await FileSystem.getInfoAsync(currentPath);
        if (!pathInfo.exists || !pathInfo.isDirectory) {
          throw new Error(`Path ${currentPath} does not exist or is not a directory`);
        }

        // Read directory
        const fileList = await FileSystem.readDirectoryAsync(currentPath);
        logger.info(`Debug: Found ${fileList.length} items in ${currentPath}`);

        // Get info for each item
        const itemsWithInfoPromises = fileList.map(async (name) => {
          const itemPath = `${currentPath}/${name}`;
          try {
            const info = await FileSystem.getInfoAsync(itemPath);
            return {
              name,
              path: itemPath,
              displayPath: itemPath.replace(/^file:\/\//, ''),
              isDirectory: info.isDirectory ?? false,
              size: info.exists && 'size' in info ? info.size : undefined,
              uri: info.uri,
              exists: info.exists,
              modificationTime: info.exists && 'modificationTime' in info ? info.modificationTime : undefined,
            };
          } catch (itemError) {
            return {
              name,
              path: itemPath,
              displayPath: itemPath.replace(/^file:\/\//, ''),
              isDirectory: false,
              exists: false,
              error: `Error: ${String(itemError)}`
            };
          }
        });

        const detailedItems = await Promise.all(itemsWithInfoPromises);
        tempDebugItems.push(...detailedItems as FileItem[]);
      } else if (pathType === 'virtual') {
        // For virtual path, show all models regardless of filter
        const allModels = getDownloadedModels();
        const modelItems = allModels
          .filter(model => model.localPath)
          .map(model => ({
            name: model.metadata.name,
            isDirectory: true,
            path: normalizePath(model.localPath!),
            displayPath: model.localPath!.replace(/^file:\/\//, ''),
            modelId: model.metadata.id,
            description: model.metadata.description,
            modelType: model.metadata.type,
            size: undefined,
            exists: true,
          }));
        tempDebugItems.push(...modelItems);
      }

      // Update debug state
      setDebugItems(tempDebugItems);
      setShowDebugInfo(true);

      logger.info(`Debug items: ${tempDebugItems.length} items found`);

    } catch (error) {
      logger.error(`Debug info error: ${error instanceof Error ? error.message : String(error)}`);
      Alert.alert("Debug Error", String(error));
    } finally {
      setLoading(false);
    }
  }, [currentPath, getDownloadedModels]);

  const navigateUp = () => {
    // Determine path type using the same logic as fetchItems
    let isActualFilePath = false;
    if (currentPath.startsWith(normalizedDocumentDirectory) || currentPath.startsWith('file://')) {
        isActualFilePath = true;
    }

    logger.info(`Navigate Up: currentPath="${currentPath}", modelRoot="${modelRootPath}", isActualFilePath=${isActualFilePath}`);

    if (!isActualFilePath) { // At virtual root
      logger.info('Navigate Up: At virtual root. Calling onBackToDownloads.');
      onBackToDownloads?.();
      return;
    }

    if (currentPath === modelRootPath) { // Exactly at the root of the selected model
      logger.info(`Navigate Up: At model root (${currentPath}). Calling onBackToDownloads.`);
      onBackToDownloads?.(); // Go back to the virtual list
      return;
    }

    // --- Parent Path Calculation (Keep as is) ---
    const pathParts = currentPath.split('/');
    if (pathParts.length <= (currentPath.startsWith('file://') ? 3 : 1)) {
       logger.warn(`Navigate Up: Cannot go further up from filesystem root.`);
       onBackToDownloads?.();
       return;
    }
    pathParts.pop();
    let parentPath = pathParts.join('/');
    // Handle edge cases like "file:///" or "/"
    if (parentPath === 'file:/') parentPath = 'file:///';
    else if (!parentPath && currentPath.startsWith('/')) parentPath = '/';

    // Safety check against navigating above model root
     if (modelRootPath && !parentPath.startsWith(modelRootPath) && parentPath !== modelRootPath) {
       logger.warn(`Navigate Up: Calculated parent "${parentPath}" is outside model root "${modelRootPath}". Returning to downloads.`);
       onBackToDownloads?.();
       return;
     }
    // --- End Parent Path Calculation ---

    logger.info(`Navigate Up: Navigating from ${currentPath} to parent: ${parentPath}`);
    onNavigate(parentPath);
  };

  const handleItemPress = (item: FileItem) => {
    if (item.isDirectory) {
      logger.info(`Navigating to folder: ${item.path}`);
      onNavigate(item.path); // Navigate using the path from the item
    } else {
      // Log detailed file information
      logger.info(`File selected: ${item.name} (${item.size ? formatBytes(item.size) : 'unknown size'}), path: ${item.path}`);

      // Copy path to clipboard and show alert
      try {
        // Copy the path to clipboard
        Clipboard.setStringAsync(item.path)
          .then(() => {
            // Show alert with path copied confirmation
            Alert.alert(
              "File Selected",
              `Path copied to clipboard:\n${item.path}`,
              [
                {
                  text: "OK",
                  style: "default"
                }
              ]
            );
          })
          .catch(error => {
            logger.error(`Failed to copy to clipboard: ${error instanceof Error ? error.message : String(error)}`);
            Alert.alert("File Selected", `Path: ${item.path}\n\nFailed to copy to clipboard.`);
          });
      } catch (error) {
        logger.error(`Error accessing clipboard: ${error instanceof Error ? error.message : String(error)}`);
        Alert.alert("File Selected", `Path: ${item.path}`);
      }
    }
  };

  // --- UI Rendering Logic ---

  const isVirtualRootDisplay = currentPath === '';
  const isBackButtonDisabled = isVirtualRootDisplay && !onBackToDownloads;
  const isShowingRealPathHeader = !isVirtualRootDisplay;

  const renderModelItem = (item: FileItem) => {
    if (isVirtualRootDisplay && item.modelId) {
       return ( // Model Card at Virtual Root
        <View style={styles.itemContent}>
          <View style={styles.itemMainContent}>
            <Text style={styles.itemName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
            {item.description && <Text style={styles.itemDescription} numberOfLines={1} ellipsizeMode="tail">{item.description}</Text>}
            {item.displayPath && <Text style={styles.itemPath} numberOfLines={1} ellipsizeMode="middle">Path: {item.displayPath}</Text>}
            {item.modelType && <Text style={styles.itemType}>Type: {item.modelType}</Text>}
          </View>
          <View style={styles.itemDetails}><Ionicons name="chevron-forward" size={20} color="#999" /></View>
        </View>
      );
    }
    return ( // Regular File/Folder Item
      <View style={styles.itemContent}>
         <View style={styles.itemMainContent}>
            <Text style={styles.itemName} numberOfLines={1} ellipsizeMode="tail">{item.name}</Text>
            {item.error && <Text style={styles.itemErrorText}>{item.error}</Text>}
         </View>
        <View style={styles.itemDetails}>
          {item.size !== undefined && !item.isDirectory && <Text style={styles.itemSize}>{formatBytes(item.size)}</Text>}
          {item.isDirectory && <Ionicons name="chevron-forward" size={20} color="#999" />}
        </View>
      </View>
    );
  };

  // Loading state display
  if (loading && items.length === 0 && !error) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#2196F3" />
        <Text>Loading: {currentPath.replace(/^file:\/\//, '')}</Text>
      </View>
    );
  }

  // Add a function to close debug overlay
  const closeDebugInfo = () => {
    setShowDebugInfo(false);
  };

  // On web platform, show unsupported message and back button
  if (Platform.OS === 'web') {
    return (
      <View style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity style={styles.backButton} onPress={onBackToDownloads}>
            <Ionicons name="arrow-back" size={24} color="#2196F3" />
            <Text style={styles.backButtonText}>Back</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.webUnsupportedContainer}>
          <Text style={styles.webUnsupportedTitle}>File Explorer Unavailable</Text>
          <Text style={styles.webUnsupportedText}>
            The file explorer feature is not available on web platforms as it requires
            native file system access.
          </Text>
          <TouchableOpacity
            style={styles.returnButton}
            onPress={onBackToDownloads}
          >
            <Text style={styles.returnButtonText}>Return to Models</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // Main component render
  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity style={styles.backButton} onPress={navigateUp} disabled={isBackButtonDisabled}>
          <Ionicons name="arrow-back" size={24} color={isBackButtonDisabled ? "#ccc" : "#2196F3"} />
        </TouchableOpacity>
        <Text style={styles.currentPathText} numberOfLines={1} ellipsizeMode="middle">
          {isShowingRealPathHeader ? currentPath.replace(/^file:\/\//, '') : 'Downloaded Models'}
        </Text>
        {isShowingRealPathHeader && (
           <TouchableOpacity style={styles.debugButton} onPress={logDirectoryContents}>
             <Ionicons name="bug" size={24} color="#ff9800" />
           </TouchableOpacity>
        )}
      </View>

      {/* Error Display */}
      {error && (
        <View style={styles.errorContainer}>
          <Text style={styles.errorText}>{error}</Text>
          {error.includes('No downloaded models') && onBackToDownloads && (
            <TouchableOpacity style={styles.downloadButton} onPress={onBackToDownloads}>
              <Text style={styles.downloadButtonText}>Go to Download Models</Text>
            </TouchableOpacity>
          )}
          {!error.includes('No downloaded models') && (
             <TouchableOpacity style={styles.retryButton} onPress={() => fetchItems()} >
               <Text style={styles.retryButtonText}>Retry</Text>
             </TouchableOpacity>
           )}
        </View>
      )}

      {/* File List */}
      <FlatList
        // Optimization: Add extraData prop if list doesn't update visually sometimes
        // extraData={items}
        data={items}
        keyExtractor={(item) => item.path}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.itemContainer}
            onPress={() => handleItemPress(item)}
            disabled={!!item.error && !item.isDirectory}
          >
            <View style={styles.itemIconContainer}>
              <Ionicons
                name={item.isDirectory ? 'folder-outline' : 'document-text-outline'}
                size={24}
                color={item.isDirectory ? (item.error ? '#ffcc80' : '#FFC107') : (item.error ? '#ef9a9a' : '#2196F3')}
              />
            </View>
            {renderModelItem(item)}
          </TouchableOpacity>
        )}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        ListEmptyComponent={
          !loading && !error ? (
            <View style={styles.emptyContainer}>
              <Text style={styles.emptyText}>
                {isVirtualRootDisplay ? 'No downloaded models found' : 'Folder is empty'}
              </Text>
            </View>
          ) : undefined
        }
      />

      {/* Debug Overlay */}
      {showDebugInfo && (
        <View style={styles.debugOverlay}>
          <View style={styles.debugHeader}>
            <Text style={styles.debugTitle}>Debug: Directory Contents</Text>
            <TouchableOpacity onPress={closeDebugInfo} style={styles.closeButton}>
              <Ionicons name="close" size={24} color="#fff" />
            </TouchableOpacity>
          </View>

          <FlatList
            data={debugItems}
            keyExtractor={(item, index) => `${item.path}-${index}`}
            renderItem={({ item }) => (
              <View style={styles.debugItem}>
                <Text style={styles.debugItemName}>{item.name}</Text>
                <Text style={styles.debugItemPath}>{item.displayPath}</Text>
                {item.isDirectory && <Text style={styles.debugItemType}>Type: Directory</Text>}
                {!item.isDirectory && item.size !== undefined && (
                  <Text style={styles.debugItemSize}>Size: {formatBytes(item.size)}</Text>
                )}
                {item.modelType && <Text style={styles.debugItemModelType}>Model Type: {item.modelType}</Text>}
                {item.state && <Text style={styles.debugItemState}>State: {item.state}</Text>}
                {item.error && <Text style={styles.debugItemError}>{item.error}</Text>}
              </View>
            )}
            ItemSeparatorComponent={() => <View style={styles.debugSeparator} />}
            ListEmptyComponent={
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No debug information available</Text>
              </View>
            }
          />
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#e0e0e0', backgroundColor: '#f8f8f8' },
  backButton: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  backButtonText: {
    marginLeft: 4,
    color: '#2196F3',
    fontSize: 16,
  },
  currentPathText: { flex: 1, fontSize: 14, color: '#666', marginHorizontal: 8 },
  debugButton: { padding: 8, marginLeft: 8 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  errorContainer: { padding: 16, backgroundColor: '#fff0f0', borderBottomWidth: 1, borderBottomColor: '#ffcccc', alignItems: 'center' },
  errorText: { color: '#d32f2f', fontSize: 14, marginBottom: 12, textAlign: 'center' },
  retryButton: { backgroundColor: '#FF9800', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, marginTop: 8 },
  retryButtonText: { color: '#fff', fontWeight: '500' },
  downloadButton: { backgroundColor: '#2196F3', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 4, marginTop: 8 },
  downloadButtonText: { color: '#fff', fontWeight: '500' },
  itemContainer: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, paddingHorizontal: 16 },
  itemIconContainer: { width: 40, alignItems: 'center', marginRight: 8 },
  itemContent: { flex: 1, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  itemMainContent: { flex: 1, marginRight: 8 },
  itemName: { fontSize: 16, fontWeight: '500', color: '#333' },
  itemDescription: { fontSize: 13, color: '#666', marginTop: 2 },
  itemPath: { fontSize: 11, color: '#888', marginTop: 2, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  itemType: { color: '#00796B', fontSize: 12, fontWeight: '500', marginTop: 2 },
  itemErrorText: { fontSize: 11, color: '#d32f2f', marginTop: 2 },
  itemDetails: { flexDirection: 'row', alignItems: 'center' },
  itemSize: { fontSize: 12, color: '#888', marginRight: 8 },
  separator: { height: 1, backgroundColor: '#f0f0f0', marginLeft: 56 },
  emptyContainer: { padding: 24, alignItems: 'center' },
  emptyText: { color: '#999', fontSize: 16, textAlign: 'center' },
  debugOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.9)',
    zIndex: 1000,
  },
  debugHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#333',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#555',
  },
  debugTitle: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  debugItem: {
    padding: 12,
    backgroundColor: '#222',
  },
  debugItemName: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '500',
    marginBottom: 4,
  },
  debugItemPath: {
    color: '#aaa',
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    marginBottom: 4,
  },
  debugItemType: {
    color: '#4fc3f7',
    fontSize: 12,
    marginBottom: 2,
  },
  debugItemSize: {
    color: '#81c784',
    fontSize: 12,
    marginBottom: 2,
  },
  debugItemModelType: {
    color: '#ba68c8',
    fontSize: 12,
    marginBottom: 2,
  },
  debugItemState: {
    color: '#ffb74d',
    fontSize: 12,
    marginBottom: 2,
  },
  debugItemError: {
    color: '#ef5350',
    fontSize: 12,
    marginBottom: 2,
  },
  debugSeparator: {
    height: 1,
    backgroundColor: '#444',
  },
  webUnsupportedContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  webUnsupportedTitle: {
    color: '#d32f2f',
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 12,
  },
  webUnsupportedText: {
    color: '#666',
    fontSize: 14,
    textAlign: 'center',
    marginBottom: 20,
  },
  returnButton: {
    backgroundColor: '#2196F3',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 4,
  },
  returnButtonText: {
    color: '#fff',
    fontWeight: '500',
  },
});
