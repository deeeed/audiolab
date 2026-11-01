// packages/sherpa-onnx.rn/ios/bridge/SherpaOnnxRnModule.mm
#import "SherpaOnnxRnModule.h"
#import <React/RCTLog.h>
#import <UIKit/UIKit.h>
#import <mach/mach.h>
#import <mach/task.h>
#import <mach/mach_init.h>

// Include Swift interop header
#import "sherpa-onnx-rn-Swift.h"

// Import our archive extractor
#import "SherpaOnnxArchiveExtractor.h"

// TurboModule headers
#import <ReactCommon/TurboModule.h>
#import <React/RCTUtils.h>
// Import the codegen-generated JSI header (from React-Codegen pod, not local copy)
#import <SherpaOnnxSpec/SherpaOnnxSpec.h>

// Add protocol conformance here (in .mm) rather than in .h, because the codegen header
// contains C++ types that break Swift module compilation if included in the .h
@interface SherpaOnnxRnModule () <NativeSherpaOnnxSpecSpec>
@end

@implementation SherpaOnnxRnModule

RCT_EXPORT_MODULE(SherpaOnnx)

// Intentionally do not override methodQueue. Returning the main queue here
// dispatches every RCT_EXPORT_METHOD body onto the iOS UI thread, which makes
// long-running ONNX inference (ASR/TTS/SpeakerId/AudioTagging) block the main
// thread and trigger App Hang reports. Each handler section below installs its
// own serial dispatch queue and wraps its method bodies in dispatch_async, in
// line with the pattern already used by KWS/VAD/LanguageId/Punctuation/
// Diarization/Denoising/OnnxInference in this file.

// Initializer
- (instancetype)init {
    NSLog(@"🚀 [SherpaOnnx] Module init called");
    self = [super init];
    if (self) {
        NSLog(@"🚀 [SherpaOnnx] Creating ASR handler...");
        @try {
            self.asrHandler = [[SherpaOnnxASRHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] ASR handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create ASR handler: %@", exception);
        }
        
        NSLog(@"🚀 [SherpaOnnx] Creating TTS handler...");
        @try {
            self.ttsHandler = [[SherpaOnnxTtsHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] TTS handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create TTS handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Audio Tagging handler...");
        @try {
            self.audioTaggingHandler = [[SherpaOnnxAudioTaggingHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Audio Tagging handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Audio Tagging handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Speaker ID handler...");
        @try {
            self.speakerIdHandler = [[SherpaOnnxSpeakerIdHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Speaker ID handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Speaker ID handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating KWS handler...");
        @try {
            self.kwsHandler = [[SherpaOnnxKWSHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] KWS handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create KWS handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating VAD handler...");
        @try {
            self.vadHandler = [[SherpaOnnxVADHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] VAD handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create VAD handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Language ID handler...");
        @try {
            self.languageIdHandler = [[SherpaOnnxLanguageIdHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Language ID handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Language ID handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Punctuation handler...");
        @try {
            self.punctuationHandler = [[SherpaOnnxPunctuationHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Punctuation handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Punctuation handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Diarization handler...");
        @try {
            self.diarizationHandler = [[SherpaOnnxDiarizationHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Diarization handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Diarization handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Denoising handler...");
        @try {
            self.denoisingHandler = [[SherpaOnnxDenoisingHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Denoising handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Denoising handler: %@", exception);
        }

        NSLog(@"🚀 [SherpaOnnx] Creating Inference handler...");
        @try {
            self.inferenceHandler = [[SherpaOnnxInferenceHandler alloc] init];
            NSLog(@"✅ [SherpaOnnx] Inference handler created");
        } @catch (NSException *exception) {
            NSLog(@"❌ [SherpaOnnx] Failed to create Inference handler: %@", exception);
        }

        NSLog(@"✅ [SherpaOnnx] Module init completed");
    } else {
        NSLog(@"❌ [SherpaOnnx] Module init failed - super init returned nil");
    }
    return self;
}

// Add a class method to verify the module loads
+ (void)initialize {
    if (self == [SherpaOnnxRnModule class]) {
        NSLog(@"🎯 [SherpaOnnx] Module class initialized");
    }
}

// Supported events (for old architecture)
- (NSArray<NSString *> *)supportedEvents {
    return @[@"sherpaOnnxRecognitionResult", @"sherpaOnnxTtsProgress"];
}

// MARK: - Test Methods

// These parameter names have to exactly match what's expected by React Native
RCT_EXPORT_METHOD(validateLibraryLoaded:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    // Use the static method from SherpaOnnxASRHandler to check if library is loaded
    NSDictionary *result = [SherpaOnnxASRHandler isLibraryLoaded];
    resolve(result);
}

// Test the ONNX integration
RCT_EXPORT_METHOD(testOnnxIntegration:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    SherpaOnnxTester *tester = [[SherpaOnnxTester alloc] init];
    [tester testIntegration:^(NSDictionary *result) {
        resolve(result);
    }];
}

// Get architecture information for debugging and diagnostics
RCT_EXPORT_METHOD(getArchitectureInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSLog(@"🔍 [SherpaOnnx] getArchitectureInfo called");
    NSString *architecture = @"ios-new";
    NSString *moduleType = @"TurboModule";
    BOOL turboModulesEnabled = YES;
    
    NSDictionary *result = @{
        @"architecture": architecture,
        @"jsiAvailable": @(NO), // JSI not exposed in iOS
        @"turboModulesEnabled": @(turboModulesEnabled),
        @"libraryLoaded": @([[SherpaOnnxASRHandler isLibraryLoaded][@"loaded"] boolValue]),
        @"currentThread": [NSThread currentThread].name ?: @"main",
        @"threadId": @([[NSThread currentThread].threadDictionary[@"threadId"] intValue] ?: 1),
        @"moduleType": moduleType
    };
    resolve(result);
}

// Get comprehensive system information for iOS
RCT_EXPORT_METHOD(getSystemInfo:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    NSLog(@"🔍 [SherpaOnnx] getSystemInfo called");
    NSString *architectureType = @"new";
    NSString *architectureDescription = @"New Architecture (TurboModules)";
    NSString *moduleType = @"TurboModule";
    BOOL turboModulesEnabled = YES;
    
    // Architecture information
    NSDictionary *architectureInfo = @{
        @"type": architectureType,
        @"description": architectureDescription,
        @"jsiAvailable": @(NO),
        @"turboModulesEnabled": @(turboModulesEnabled),
        @"moduleType": moduleType
    };
    
    // Memory information
    NSProcessInfo *processInfo = [NSProcessInfo processInfo];
    double totalMemoryMB = processInfo.physicalMemory / 1024.0 / 1024.0;
    
    // Get current memory usage
    struct mach_task_basic_info info;
    mach_msg_type_number_t size = MACH_TASK_BASIC_INFO_COUNT;
    if (task_info(mach_task_self(), MACH_TASK_BASIC_INFO, (task_info_t)&info, &size) == KERN_SUCCESS) {
        double usedMemoryMB = info.resident_size / 1024.0 / 1024.0;
        
        NSDictionary *memoryInfo = @{
            @"maxMemoryMB": @(totalMemoryMB),
            @"totalMemoryMB": @(totalMemoryMB),
            @"freeMemoryMB": @(totalMemoryMB - usedMemoryMB),
            @"usedMemoryMB": @(usedMemoryMB),
            @"systemTotalMemoryMB": @(totalMemoryMB)
        };
        
        // CPU information
        NSDictionary *cpuInfo = @{
            @"availableProcessors": @(processInfo.processorCount),
            @"supportedAbis": @[@"arm64", @"x86_64"] // iOS supports these architectures
        };
        
        // Device information
        UIDevice *device = [UIDevice currentDevice];
        NSDictionary *deviceInfo = @{
            @"brand": @"Apple",
            @"model": device.model,
            @"device": device.name,
            @"manufacturer": @"Apple",
            @"iosVersion": device.systemVersion
        };
        
        // GPU information - Metal support
        NSString *metalVersion = @"Metal";
        #if TARGET_OS_SIMULATOR
        metalVersion = @"Metal (Simulator)";
        #endif
        
        NSDictionary *gpuInfo = @{
            @"metalVersion": metalVersion
        };
        
        // Thread information
        NSDictionary *threadInfo = @{
            @"currentThread": [NSThread currentThread].name ?: @"main",
            @"threadId": @([[NSThread currentThread].threadDictionary[@"threadId"] intValue] ?: 1)
        };
        
        NSDictionary *result = @{
            @"architecture": architectureInfo,
            @"memory": memoryInfo,
            @"cpu": cpuInfo,
            @"device": deviceInfo,
            @"gpu": gpuInfo,
            @"libraryLoaded": @([[SherpaOnnxASRHandler isLibraryLoaded][@"loaded"] boolValue]),
            @"thread": threadInfo
        };
        resolve(result);
    } else {
        reject(@"system_info_error", @"Failed to get system information", nil);
    }
}

// MARK: - Archive Methods

// Extract a tar.bz2 file to a target directory
RCT_EXPORT_METHOD(extractTarBz2:(NSString *)sourcePath
                  targetDir:(NSString *)targetDir
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject) {
    
    [SherpaOnnxArchiveExtractor extractTarBz2:sourcePath targetDir:targetDir completion:^(SherpaOnnxExtractionResult *result) {
        if (result.success) {
            // Create result dictionary for JS
            NSDictionary *resultDict = @{
                @"success": @(result.success),
                @"message": result.message,
                @"extractedFiles": result.extractedFiles
            };
            resolve(resultDict);
        } else {
            reject(@"extract_error", result.message, nil);
        }
    }];
}

// MARK: - ASR Methods

static dispatch_queue_t _asrSerialQueue;
static dispatch_once_t _asrQueueOnce;

static dispatch_queue_t asrSerialQueue(void) {
    dispatch_once(&_asrQueueOnce, ^{
        _asrSerialQueue = dispatch_queue_create("com.sherpaonnx.asr", DISPATCH_QUEUE_SERIAL);
    });
    return _asrSerialQueue;
}

// Initialize ASR with the provided configuration
RCT_EXPORT_METHOD(initAsr:(JS::NativeSherpaOnnxSpec::SpecInitAsrConfig &)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
    NSString *modelDir = config.modelDir();
    NSString *modelType = config.modelType();
    NSString *modelPath = config.modelPath();
    auto numThreads = config.numThreads();
    auto debug = config.debug();
    auto streaming = config.streaming();
    auto sampleRate = config.sampleRate();
    auto featureDim = config.featureDim();
    NSString *decodingMethod = config.decodingMethod();
    auto maxActivePaths = config.maxActivePaths();
    NSString *provider = config.provider();

    // Optional ASR-side hints / generation knobs
    NSString *language = config.language();
    NSString *task = config.task();
    auto useItn = config.useItn();
    NSString *srcLang = config.srcLang();
    NSString *tgtLang = config.tgtLang();
    auto usePnc = config.usePnc();
    auto usePunct = config.usePunct();
    NSString *hotwords = config.hotwords();
    auto qwen3MaxTotalLen = config.qwen3MaxTotalLen();
    auto qwen3MaxNewTokens = config.qwen3MaxNewTokens();
    auto qwen3Temperature = config.qwen3Temperature();
    auto qwen3TopP = config.qwen3TopP();
    auto qwen3Seed = config.qwen3Seed();

    // Model file paths (flattened from modelFiles object)
    NSString *modelFileEncoder = config.modelFileEncoder();
    NSString *modelFileDecoder = config.modelFileDecoder();
    NSString *modelFileJoiner = config.modelFileJoiner();
    NSString *modelFileTokens = config.modelFileTokens();
    NSString *modelFileModel = config.modelFileModel();
    NSString *modelFilePreprocessor = config.modelFilePreprocessor();
    NSString *modelFileUncachedDecoder = config.modelFileUncachedDecoder();
    NSString *modelFileCachedDecoder = config.modelFileCachedDecoder();
    NSString *modelFileMergedDecoder = config.modelFileMergedDecoder();
    NSString *modelFileConvFrontend = config.modelFileConvFrontend();
    NSString *modelFileTokenizer = config.modelFileTokenizer();

    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (modelDir) [configDict setObject:modelDir forKey:@"modelDir"];
    if (modelType) [configDict setObject:modelType forKey:@"modelType"];
    if (modelPath) [configDict setObject:modelPath forKey:@"modelPath"];
    if (numThreads) [configDict setObject:@(*numThreads) forKey:@"numThreads"];
    if (debug) [configDict setObject:@(*debug) forKey:@"debug"];
    if (streaming) [configDict setObject:@(*streaming) forKey:@"streaming"];
    if (sampleRate) [configDict setObject:@(*sampleRate) forKey:@"sampleRate"];
    if (featureDim) [configDict setObject:@(*featureDim) forKey:@"featureDim"];
    if (decodingMethod) [configDict setObject:decodingMethod forKey:@"decodingMethod"];
    if (maxActivePaths) [configDict setObject:@(*maxActivePaths) forKey:@"maxActivePaths"];
    if (provider) [configDict setObject:provider forKey:@"provider"];
    if (language) [configDict setObject:language forKey:@"language"];
    if (task) [configDict setObject:task forKey:@"task"];
    if (useItn) [configDict setObject:@(*useItn) forKey:@"useItn"];
    if (srcLang) [configDict setObject:srcLang forKey:@"srcLang"];
    if (tgtLang) [configDict setObject:tgtLang forKey:@"tgtLang"];
    if (usePnc) [configDict setObject:@(*usePnc) forKey:@"usePnc"];
    if (usePunct) [configDict setObject:@(*usePunct) forKey:@"usePunct"];
    if (hotwords) [configDict setObject:hotwords forKey:@"hotwords"];
    if (qwen3MaxTotalLen) [configDict setObject:@(*qwen3MaxTotalLen) forKey:@"qwen3MaxTotalLen"];
    if (qwen3MaxNewTokens) [configDict setObject:@(*qwen3MaxNewTokens) forKey:@"qwen3MaxNewTokens"];
    if (qwen3Temperature) [configDict setObject:@(*qwen3Temperature) forKey:@"qwen3Temperature"];
    if (qwen3TopP) [configDict setObject:@(*qwen3TopP) forKey:@"qwen3TopP"];
    if (qwen3Seed) [configDict setObject:@(*qwen3Seed) forKey:@"qwen3Seed"];

    // Build modelFiles sub-dictionary
    NSMutableDictionary *modelFiles = [NSMutableDictionary dictionary];
    if (modelFileEncoder) [modelFiles setObject:modelFileEncoder forKey:@"encoder"];
    if (modelFileDecoder) [modelFiles setObject:modelFileDecoder forKey:@"decoder"];
    if (modelFileJoiner) [modelFiles setObject:modelFileJoiner forKey:@"joiner"];
    if (modelFileTokens) [modelFiles setObject:modelFileTokens forKey:@"tokens"];
    if (modelFileModel) [modelFiles setObject:modelFileModel forKey:@"model"];
    if (modelFilePreprocessor) [modelFiles setObject:modelFilePreprocessor forKey:@"preprocessor"];
    if (modelFileUncachedDecoder) [modelFiles setObject:modelFileUncachedDecoder forKey:@"uncachedDecoder"];
    if (modelFileCachedDecoder) [modelFiles setObject:modelFileCachedDecoder forKey:@"cachedDecoder"];
    if (modelFileMergedDecoder) [modelFiles setObject:modelFileMergedDecoder forKey:@"mergedDecoder"];
    if (modelFileConvFrontend) [modelFiles setObject:modelFileConvFrontend forKey:@"convFrontend"];
    if (modelFileTokenizer) [modelFiles setObject:modelFileTokenizer forKey:@"tokenizer"];
    if (modelFiles.count > 0) [configDict setObject:modelFiles forKey:@"modelFiles"];

    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler initAsr:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_INIT", exception.reason, nil);
        }
    });
}

// Recognize speech from audio samples
RCT_EXPORT_METHOD(recognizeFromSamples:(double)sampleRate
                               samples:(NSArray *)samples
                          resolve:(RCTPromiseResolveBlock)resolve
                          reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler recognizeFromSamples:(int)sampleRate samples:samples];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_RECOGNIZE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_RECOGNIZE", exception.reason, nil);
        }
    });
}

// Recognize speech from an audio file
RCT_EXPORT_METHOD(recognizeFromFile:(NSString *)filePath
                       resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler recognizeFromFile:filePath];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_RECOGNIZE_FILE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_RECOGNIZE_FILE", exception.reason, nil);
        }
    });
}

// Release ASR resources
RCT_EXPORT_METHOD(releaseAsr:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler releaseResources];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - ASR Online Streaming Methods

RCT_EXPORT_METHOD(createAsrOnlineStream:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler createAsrOnlineStream];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_STREAM", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_STREAM", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(acceptAsrOnlineWaveform:(double)sampleRate
                  samples:(NSArray *)samples
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler acceptAsrOnlineWaveform:(int)sampleRate samples:samples];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_WAVEFORM", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_WAVEFORM", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(isAsrOnlineEndpoint:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler isAsrOnlineEndpoint];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_ENDPOINT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(getAsrOnlineResult:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler getAsrOnlineResult];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_RESULT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(finishAsrOnlineInput:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler finishAsrOnlineInput];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_FINISH", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_FINISH", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(resetAsrOnlineStream:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(asrSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.asrHandler resetAsrOnlineStream];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ASR_RESET", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ASR_RESET", exception.reason, nil);
        }
    });
}

// MARK: - TTS Methods

static dispatch_queue_t _ttsSerialQueue;
static dispatch_once_t _ttsQueueOnce;

static dispatch_queue_t ttsSerialQueue(void) {
    dispatch_once(&_ttsQueueOnce, ^{
        _ttsSerialQueue = dispatch_queue_create("com.sherpaonnx.tts", DISPATCH_QUEUE_SERIAL);
    });
    return _ttsSerialQueue;
}


RCT_EXPORT_METHOD(initTts:(JS::NativeSherpaOnnxSpec::SpecInitTtsConfig &)config
                 resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
    NSString *modelDir = config.modelDir();
    NSString *ttsModelType = config.ttsModelType();
    NSString *modelFile = config.modelFile();
    NSString *tokensFile = config.tokensFile();
    NSString *acousticModelName = config.acousticModelName();
    NSString *vocoderFile = config.vocoderFile();
    NSString *voicesFile = config.voicesFile();
    NSString *lexiconFile = config.lexiconFile();
    NSString *dataDir = config.dataDir();
    NSString *dictDir = config.dictDir();
    NSString *ruleFsts = config.ruleFsts();
    NSString *ruleFars = config.ruleFars();
    auto numThreads = config.numThreads();
    auto debug = config.debug();
    auto noiseScale = config.noiseScale();
    auto noiseScaleW = config.noiseScaleW();
    auto lengthScale = config.lengthScale();
    NSString *lang = config.lang();

    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (modelDir) [configDict setObject:modelDir forKey:@"modelDir"];
    if (ttsModelType) [configDict setObject:ttsModelType forKey:@"ttsModelType"];
    if (modelFile) [configDict setObject:modelFile forKey:@"modelFile"];
    if (tokensFile) [configDict setObject:tokensFile forKey:@"tokensFile"];
    if (acousticModelName) [configDict setObject:acousticModelName forKey:@"acousticModelName"];
    if (vocoderFile) [configDict setObject:vocoderFile forKey:@"vocoderFile"];
    if (voicesFile) [configDict setObject:voicesFile forKey:@"voicesFile"];
    if (lexiconFile) [configDict setObject:lexiconFile forKey:@"lexiconFile"];
    if (dataDir) [configDict setObject:dataDir forKey:@"dataDir"];
    if (dictDir) [configDict setObject:dictDir forKey:@"dictDir"];
    if (ruleFsts) [configDict setObject:ruleFsts forKey:@"ruleFsts"];
    if (ruleFars) [configDict setObject:ruleFars forKey:@"ruleFars"];
    if (numThreads) [configDict setObject:@(*numThreads) forKey:@"numThreads"];
    if (debug) [configDict setObject:@(*debug) forKey:@"debug"];
    if (noiseScale) [configDict setObject:@(*noiseScale) forKey:@"noiseScale"];
    if (noiseScaleW) [configDict setObject:@(*noiseScaleW) forKey:@"noiseScaleW"];
    if (lengthScale) [configDict setObject:@(*lengthScale) forKey:@"lengthScale"];
    if (lang) [configDict setObject:lang forKey:@"lang"];
    RCTLogInfo(@"[SherpaOnnxRnModule.mm] initTts entered.");
    dispatch_async(ttsSerialQueue(), ^{
        @try {
            RCTLogInfo(@"[SherpaOnnxRnModule.mm] Calling Swift ttsHandler.initTts...");
            NSDictionary *result = [self.ttsHandler initTts:configDict]; // Directly pass the dictionary
            RCTLogInfo(@"[SherpaOnnxRnModule.mm] Swift ttsHandler.initTts returned: %@", result);
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_TTS_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_TTS_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(generateTts:(JS::NativeSherpaOnnxSpec::SpecGenerateTtsConfig &)config
                   resolve:(RCTPromiseResolveBlock)resolve
                   reject:(RCTPromiseRejectBlock)reject)
{
    NSString *text = config.text();
    double speakerId = config.speakerId();
    double speakingRate = config.speakingRate();
    bool playAudio = config.playAudio();
    NSString *fileNamePrefix = config.fileNamePrefix();
    auto lengthScale = config.lengthScale();
    auto noiseScale = config.noiseScale();
    auto noiseScaleW = config.noiseScaleW();
    auto phonemeCodepoints = config.phonemeCodepoints();

    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (text) [configDict setObject:text forKey:@"text"];
    [configDict setObject:@(speakerId) forKey:@"speakerId"];
    [configDict setObject:@(speakingRate) forKey:@"speakingRate"];
    [configDict setObject:@(playAudio) forKey:@"playAudio"];
    if (fileNamePrefix) [configDict setObject:fileNamePrefix forKey:@"fileNamePrefix"];
    if (lengthScale) [configDict setObject:@(*lengthScale) forKey:@"lengthScale"];
    if (noiseScale) [configDict setObject:@(*noiseScale) forKey:@"noiseScale"];
    if (noiseScaleW) [configDict setObject:@(*noiseScaleW) forKey:@"noiseScaleW"];
    if (phonemeCodepoints) {
        NSMutableArray *sentences = [NSMutableArray array];
        for (const auto &sentence : *phonemeCodepoints) {
            NSMutableArray *codepoints = [NSMutableArray array];
            for (double codepoint : sentence) [codepoints addObject:@(codepoint)];
            [sentences addObject:codepoints];
        }
        [configDict setObject:sentences forKey:@"phonemeCodepoints"];
    }
    dispatch_async(ttsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.ttsHandler generateTts:configDict]; // Directly pass dict
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_TTS_GENERATE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_TTS_GENERATE", exception.reason, nil);
        }
    });
}

// Stop TTS playback
RCT_EXPORT_METHOD(stopTts:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(ttsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.ttsHandler stopTts];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_TTS_STOP", exception.reason, nil);
        }
    });
}

// Release TTS resources
RCT_EXPORT_METHOD(releaseTts:(RCTPromiseResolveBlock)resolve
                reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(ttsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.ttsHandler releaseTts];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_TTS_RELEASE", exception.reason, nil);
        }
    });
}

// Implementation of getTurboModule for TurboModule support
- (std::shared_ptr<facebook::react::TurboModule>)getTurboModule:(const facebook::react::ObjCTurboModule::InitParams &)params
{
  return std::make_shared<facebook::react::NativeSherpaOnnxSpecSpecJSI>(params);
}

// MARK: - Audio Tagging Methods

static dispatch_queue_t _audioTaggingSerialQueue;
static dispatch_once_t _audioTaggingQueueOnce;

static dispatch_queue_t audioTaggingSerialQueue(void) {
    dispatch_once(&_audioTaggingQueueOnce, ^{
        _audioTaggingSerialQueue = dispatch_queue_create("com.sherpaonnx.audiotagging", DISPATCH_QUEUE_SERIAL);
    });
    return _audioTaggingSerialQueue;
}

RCT_EXPORT_METHOD(initAudioTagging:(JS::NativeSherpaOnnxSpec::SpecInitAudioTaggingConfig &)config
                 resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSString *modelDir = config.modelDir();
    NSString *modelType = config.modelType();
    NSString *modelFile = config.modelFile();
    NSString *labelsFile = config.labelsFile();
    auto numThreads = config.numThreads();
    auto topK = config.topK();
    auto debug = config.debug();

    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (modelDir) [configDict setObject:modelDir forKey:@"modelDir"];
    if (modelType) [configDict setObject:modelType forKey:@"modelType"];
    if (modelFile) [configDict setObject:modelFile forKey:@"modelFile"];
    if (labelsFile) [configDict setObject:labelsFile forKey:@"labelsFile"];
    if (numThreads) [configDict setObject:@(*numThreads) forKey:@"numThreads"];
    if (topK) [configDict setObject:@(*topK) forKey:@"topK"];
    if (debug) [configDict setObject:@(*debug) forKey:@"debug"];

    dispatch_async(audioTaggingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.audioTaggingHandler initAudioTagging:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_AUDIO_TAGGING_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_AUDIO_TAGGING_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processAndComputeAudioTagging:(NSString *)filePath
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(audioTaggingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.audioTaggingHandler processAndComputeFile:filePath];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_AUDIO_TAGGING_COMPUTE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_AUDIO_TAGGING_COMPUTE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processAndComputeAudioSamples:(double)sampleRate
                              samples:(NSArray *)samples
                              resolve:(RCTPromiseResolveBlock)resolve
                               reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(audioTaggingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.audioTaggingHandler processAndComputeSamples:(int)sampleRate samples:samples];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_AUDIO_TAGGING_COMPUTE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_AUDIO_TAGGING_COMPUTE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseAudioTagging:(RCTPromiseResolveBlock)resolve
                     reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(audioTaggingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.audioTaggingHandler releaseResources];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_AUDIO_TAGGING_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - Speaker ID Methods

static dispatch_queue_t _speakerIdSerialQueue;
static dispatch_once_t _speakerIdQueueOnce;

static dispatch_queue_t speakerIdSerialQueue(void) {
    dispatch_once(&_speakerIdQueueOnce, ^{
        _speakerIdSerialQueue = dispatch_queue_create("com.sherpaonnx.speakerid", DISPATCH_QUEUE_SERIAL);
    });
    return _speakerIdSerialQueue;
}

RCT_EXPORT_METHOD(initSpeakerId:(JS::NativeSherpaOnnxSpec::SpecInitSpeakerIdConfig &)config
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
{
    NSString *modelDir = config.modelDir();
    NSString *modelFile = config.modelFile();
    NSString *modelType = config.modelType();
    auto numThreads = config.numThreads();
    NSString *provider = config.provider();
    auto debug = config.debug();

    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (modelDir) [configDict setObject:modelDir forKey:@"modelDir"];
    if (modelFile) [configDict setObject:modelFile forKey:@"modelFile"];
    if (modelType) [configDict setObject:modelType forKey:@"modelType"];
    if (numThreads) [configDict setObject:@(*numThreads) forKey:@"numThreads"];
    if (provider) [configDict setObject:provider forKey:@"provider"];
    if (debug) [configDict setObject:@(*debug) forKey:@"debug"];

    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler initSpeakerId:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processSpeakerIdSamples:(double)sampleRate
                        samples:(NSArray *)samples
                        resolve:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler processSamples:(int)sampleRate samples:samples];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_PROCESS", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_PROCESS", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(computeSpeakerEmbedding:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler computeEmbedding];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_COMPUTE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_COMPUTE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(resetSpeakerIdStream:(RCTPromiseResolveBlock)resolve
                         reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler resetStream];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_RESET", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_RESET", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(registerSpeaker:(NSString *)name
              embedding:(NSArray *)embedding
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler registerSpeaker:name embedding:embedding];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_REGISTER", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_REGISTER", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(removeSpeaker:(NSString *)name
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler removeSpeaker:name];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_REMOVE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_REMOVE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(getSpeakers:(RCTPromiseResolveBlock)resolve
             reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler getSpeakers];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_GET_SPEAKERS", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(identifySpeaker:(NSArray *)embedding
              threshold:(double)threshold
                resolve:(RCTPromiseResolveBlock)resolve
                 reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler identifySpeaker:embedding threshold:(float)threshold];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_IDENTIFY", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(verifySpeaker:(NSString *)name
            embedding:(NSArray *)embedding
            threshold:(double)threshold
              resolve:(RCTPromiseResolveBlock)resolve
               reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler verifySpeaker:name embedding:embedding threshold:(float)threshold];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_VERIFY", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processSpeakerIdFile:(NSString *)filePath
                     resolve:(RCTPromiseResolveBlock)resolve
                      reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler processFile:filePath];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_PROCESS_FILE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_PROCESS_FILE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processSpeakerIdFileWindow:(NSString *)filePath
                  startTimeMs:(double)startTimeMs
                   durationMs:(double)durationMs
                      resolve:(RCTPromiseResolveBlock)resolve
                       reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler processFileWindow:filePath startTimeMs:startTimeMs durationMs:durationMs];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_SPEAKER_ID_PROCESS_FILE_WINDOW", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_PROCESS_FILE_WINDOW", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseSpeakerId:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(speakerIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.speakerIdHandler releaseResources];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_SPEAKER_ID_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - KWS Methods

static dispatch_queue_t _kwsSerialQueue;
static dispatch_once_t _kwsQueueOnce;

static dispatch_queue_t kwsSerialQueue(void) {
    dispatch_once(&_kwsQueueOnce, ^{
        _kwsSerialQueue = dispatch_queue_create("com.sherpaonnx.kws", DISPATCH_QUEUE_SERIAL);
    });
    return _kwsSerialQueue;
}

RCT_EXPORT_METHOD(initKws:(JS::NativeSherpaOnnxSpec::SpecInitKwsConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    // Extract fields from codegen struct into NSDictionary for Swift handler
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelDir()) [configDict setObject:config.modelDir() forKey:@"modelDir"];
    if (config.modelType()) [configDict setObject:config.modelType() forKey:@"modelType"];
    if (config.modelFileEncoder()) [configDict setObject:config.modelFileEncoder() forKey:@"modelFileEncoder"];
    if (config.modelFileDecoder()) [configDict setObject:config.modelFileDecoder() forKey:@"modelFileDecoder"];
    if (config.modelFileJoiner()) [configDict setObject:config.modelFileJoiner() forKey:@"modelFileJoiner"];
    if (config.modelFileTokens()) [configDict setObject:config.modelFileTokens() forKey:@"modelFileTokens"];
    if (config.keywordsFile()) [configDict setObject:config.keywordsFile() forKey:@"keywordsFile"];
    if (config.numThreads()) [configDict setObject:@(*config.numThreads()) forKey:@"numThreads"];
    if (config.debug()) [configDict setObject:@(*config.debug()) forKey:@"debug"];
    if (config.provider()) [configDict setObject:config.provider() forKey:@"provider"];
    if (config.maxActivePaths()) [configDict setObject:@(*config.maxActivePaths()) forKey:@"maxActivePaths"];
    if (config.keywordsScore()) [configDict setObject:@(*config.keywordsScore()) forKey:@"keywordsScore"];
    if (config.keywordsThreshold()) [configDict setObject:@(*config.keywordsThreshold()) forKey:@"keywordsThreshold"];
    if (config.numTrailingBlanks()) [configDict setObject:@(*config.numTrailingBlanks()) forKey:@"numTrailingBlanks"];

    dispatch_async(kwsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.kwsHandler initKws:configDict];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_KWS_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(acceptKwsWaveform:(double)sampleRate
                  samples:(NSArray *)samples
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(kwsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.kwsHandler acceptWaveform:(int)sampleRate samples:samples];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_KWS_ACCEPT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(resetKwsStream:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(kwsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.kwsHandler resetStream];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_KWS_RESET", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseKws:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(kwsSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.kwsHandler releaseKws];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_KWS_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - VAD Methods

static dispatch_queue_t _vadSerialQueue;
static dispatch_once_t _vadQueueOnce;

static dispatch_queue_t vadSerialQueue(void) {
    dispatch_once(&_vadQueueOnce, ^{
        _vadSerialQueue = dispatch_queue_create("com.sherpaonnx.vad", DISPATCH_QUEUE_SERIAL);
    });
    return _vadSerialQueue;
}

RCT_EXPORT_METHOD(initVad:(JS::NativeSherpaOnnxSpec::SpecInitVadConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelDir()) [configDict setObject:config.modelDir() forKey:@"modelDir"];
    if (config.modelFile()) [configDict setObject:config.modelFile() forKey:@"modelFile"];
    if (config.threshold()) [configDict setObject:@(*config.threshold()) forKey:@"threshold"];
    if (config.minSilenceDuration()) [configDict setObject:@(*config.minSilenceDuration()) forKey:@"minSilenceDuration"];
    if (config.minSpeechDuration()) [configDict setObject:@(*config.minSpeechDuration()) forKey:@"minSpeechDuration"];
    if (config.windowSize()) [configDict setObject:@(*config.windowSize()) forKey:@"windowSize"];
    if (config.maxSpeechDuration()) [configDict setObject:@(*config.maxSpeechDuration()) forKey:@"maxSpeechDuration"];
    if (config.bufferSizeInSeconds()) [configDict setObject:@(*config.bufferSizeInSeconds()) forKey:@"bufferSizeInSeconds"];
    if (config.numThreads()) [configDict setObject:@(*config.numThreads()) forKey:@"numThreads"];
    if (config.debug()) [configDict setObject:@(*config.debug()) forKey:@"debug"];
    if (config.provider()) [configDict setObject:config.provider() forKey:@"provider"];

    dispatch_async(vadSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.vadHandler initVad:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_VAD_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_VAD_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(acceptVadWaveform:(double)sampleRate
                  samples:(NSArray *)samples
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(vadSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.vadHandler acceptWaveform:(int)sampleRate samples:samples];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_VAD_ACCEPT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(resetVad:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(vadSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.vadHandler resetVad];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_VAD_RESET", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseVad:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(vadSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.vadHandler releaseVad];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_VAD_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - Language ID Methods

static dispatch_queue_t langIdSerialQueue() {
    static dispatch_queue_t queue;
    static dispatch_once_t _langIdQueueOnce;
    dispatch_once(&_langIdQueueOnce, ^{
        queue = dispatch_queue_create("com.sherpaonnx.langid", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

RCT_EXPORT_METHOD(initLanguageId:(JS::NativeSherpaOnnxSpec::SpecInitLanguageIdConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelDir()) configDict[@"modelDir"] = config.modelDir();
    if (config.encoderFile()) configDict[@"encoderFile"] = config.encoderFile();
    if (config.decoderFile()) configDict[@"decoderFile"] = config.decoderFile();
    if (config.numThreads()) configDict[@"numThreads"] = @((int)*config.numThreads());
    if (config.debug()) configDict[@"debug"] = @(*config.debug());
    if (config.provider()) configDict[@"provider"] = config.provider();

    dispatch_async(langIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.languageIdHandler initLanguageId:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_LANGUAGE_ID_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_LANGUAGE_ID_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(detectLanguage:(double)sampleRate
                  samples:(NSArray *)samples
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(langIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.languageIdHandler detectLanguage:(int)sampleRate samples:samples];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_LANGUAGE_ID_DETECT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(detectLanguageFromFile:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(langIdSerialQueue(), ^{
        if (!filePath || filePath.length == 0) {
            resolve(@{@"success": @NO, @"error": @"File path is required"});
            return;
        }

        @try {
            NSDictionary *result = [self.languageIdHandler detectLanguageFromFile:filePath];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_LANGUAGE_ID_FILE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseLanguageId:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(langIdSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.languageIdHandler releaseLanguageId];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_LANGUAGE_ID_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - Punctuation Methods

static dispatch_queue_t punctSerialQueue(void) {
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("com.sherpaonnx.punct", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

RCT_EXPORT_METHOD(initPunctuation:(JS::NativeSherpaOnnxSpec::SpecInitPunctuationConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelDir()) configDict[@"modelDir"] = config.modelDir();
    if (config.cnnBilstm()) configDict[@"cnnBilstm"] = config.cnnBilstm();
    if (config.model()) configDict[@"model"] = config.model();
    if (config.bpeVocab()) configDict[@"bpeVocab"] = config.bpeVocab();
    if (config.numThreads()) configDict[@"numThreads"] = @((int)*config.numThreads());
    if (config.debug()) configDict[@"debug"] = @(*config.debug());
    if (config.provider()) configDict[@"provider"] = config.provider();

    dispatch_async(punctSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.punctuationHandler initPunctuation:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_PUNCTUATION_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_PUNCTUATION_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(addPunctuation:(NSString *)text
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(punctSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.punctuationHandler addPunctuation:text];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_PUNCTUATION_ADD", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releasePunctuation:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(punctSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.punctuationHandler releasePunctuation];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_PUNCTUATION_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - Diarization Methods

static dispatch_queue_t diarizationSerialQueue(void) {
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("com.sherpaonnx.diarization", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

RCT_EXPORT_METHOD(initDiarization:(JS::NativeSherpaOnnxSpec::SpecInitDiarizationConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.segmentationModelDir()) configDict[@"segmentationModelDir"] = config.segmentationModelDir();
    if (config.segmentationModelFile()) configDict[@"segmentationModelFile"] = config.segmentationModelFile();
    if (config.embeddingModelFile()) configDict[@"embeddingModelFile"] = config.embeddingModelFile();
    if (config.numThreads()) configDict[@"numThreads"] = @((int)*config.numThreads());
    if (config.debug()) configDict[@"debug"] = @(*config.debug());
    if (config.provider()) configDict[@"provider"] = config.provider();
    if (config.minDurationOn()) configDict[@"minDurationOn"] = @((float)*config.minDurationOn());
    if (config.minDurationOff()) configDict[@"minDurationOff"] = @((float)*config.minDurationOff());
    if (config.numClusters()) configDict[@"numClusters"] = @((int)*config.numClusters());
    if (config.threshold()) configDict[@"threshold"] = @((float)*config.threshold());

    dispatch_async(diarizationSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.diarizationHandler initDiarization:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_DIARIZATION_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_DIARIZATION_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processDiarizationFile:(NSString *)filePath
                  numClusters:(double)numClusters
                  threshold:(double)threshold
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(diarizationSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.diarizationHandler processDiarizationFile:filePath
                                                                       numClusters:(int)numClusters
                                                                         threshold:(float)threshold];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_DIARIZATION_PROCESS", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_DIARIZATION_PROCESS", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(processDiarizationFileWindow:(NSString *)filePath
                  startTimeMs:(double)startTimeMs
                  durationMs:(double)durationMs
                  numClusters:(double)numClusters
                  threshold:(double)threshold
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(diarizationSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.diarizationHandler processDiarizationFileWindow:filePath
                                                                            startTimeMs:startTimeMs
                                                                             durationMs:durationMs
                                                                            numClusters:(int)numClusters
                                                                              threshold:(float)threshold];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_DIARIZATION_PROCESS_WINDOW", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_DIARIZATION_PROCESS_WINDOW", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseDiarization:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(diarizationSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.diarizationHandler releaseDiarization];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_DIARIZATION_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - Denoising Methods

static dispatch_queue_t denoisingSerialQueue(void) {
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("com.sherpaonnx.denoising", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

RCT_EXPORT_METHOD(initDenoiser:(JS::NativeSherpaOnnxSpec::SpecInitDenoiserConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelFile()) configDict[@"modelFile"] = config.modelFile();
    if (config.numThreads()) configDict[@"numThreads"] = @((int)*config.numThreads());
    if (config.provider()) configDict[@"provider"] = config.provider();
    if (config.debug()) configDict[@"debug"] = @(*config.debug());

    dispatch_async(denoisingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.denoisingHandler initDenoiser:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_DENOISER_INIT", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_DENOISER_INIT", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(denoiseFile:(NSString *)filePath
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(denoisingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.denoisingHandler denoiseFile:filePath];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_DENOISER_RUN", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_DENOISER_RUN", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseDenoiser:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(denoisingSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.denoisingHandler releaseDenoiser];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_DENOISER_RELEASE", exception.reason, nil);
        }
    });
}

// MARK: - ONNX Inference Methods

static dispatch_queue_t inferenceSerialQueue(void) {
    static dispatch_queue_t queue;
    static dispatch_once_t onceToken;
    dispatch_once(&onceToken, ^{
        queue = dispatch_queue_create("com.sherpaonnx.inference", DISPATCH_QUEUE_SERIAL);
    });
    return queue;
}

RCT_EXPORT_METHOD(createOnnxSession:(JS::NativeSherpaOnnxSpec::SpecCreateOnnxSessionConfig &)config
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    NSMutableDictionary *configDict = [NSMutableDictionary dictionary];
    if (config.modelPath()) configDict[@"modelPath"] = config.modelPath();
    if (config.numThreads()) configDict[@"numThreads"] = @((int)*config.numThreads());

    dispatch_async(inferenceSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.inferenceHandler createSession:configDict];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ONNX_CREATE", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ONNX_CREATE", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(runOnnxSession:(NSString *)sessionId
                  inputNames:(NSArray<NSString *> *)inputNames
                  inputTypes:(NSArray<NSString *> *)inputTypes
                  inputDims:(NSArray<NSString *> *)inputDims
                  inputData:(NSArray<NSString *> *)inputData
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(inferenceSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.inferenceHandler runSessionWithArrays:sessionId
                                                                   inputNames:inputNames
                                                                   inputTypes:inputTypes
                                                                    inputDims:inputDims
                                                                    inputData:inputData];
            if ([result[@"success"] boolValue]) {
                resolve(result);
            } else {
                reject(@"ERR_ONNX_RUN", result[@"error"], nil);
            }
        } @catch (NSException *exception) {
            reject(@"ERR_ONNX_RUN", exception.reason, nil);
        }
    });
}

RCT_EXPORT_METHOD(releaseOnnxSession:(NSString *)sessionId
                  resolve:(RCTPromiseResolveBlock)resolve
                  reject:(RCTPromiseRejectBlock)reject)
{
    dispatch_async(inferenceSerialQueue(), ^{
        @try {
            NSDictionary *result = [self.inferenceHandler releaseSession:sessionId];
            resolve(result);
        } @catch (NSException *exception) {
            reject(@"ERR_ONNX_RELEASE", exception.reason, nil);
        }
    });
}

@end
