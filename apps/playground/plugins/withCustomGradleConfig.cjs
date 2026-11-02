/* eslint-disable @typescript-eslint/no-require-imports */
const {
    withProjectBuildGradle,
    withAppBuildGradle,
    withGradleProperties,
    withDangerousMod,
} = require('@expo/config-plugins')
const fs = require('node:fs')
const path = require('node:path')
/* eslint-enable @typescript-eslint/no-require-imports */

module.exports = function withCustomGradleConfig(config) {
    // First, handle the build.gradle modifications with existing code
    config = withProjectBuildGradle(config, (config) => {
        // Gradle's worker limit does not limit Ninja's compiler processes.
        // CMake job pools also remain effective when EAS sets GRADLE_OPTS.
        if (!config.modResults.contents.includes('-DCMAKE_JOB_POOLS=native_compile=1')) {
            const nativeCompileConfig = `
subprojects {
    ["com.android.library", "com.android.application"].each { androidPlugin ->
        plugins.withId(androidPlugin) {
            androidComponents.finalizeDsl { androidDsl ->
                androidDsl.defaultConfig.externalNativeBuild.cmake.arguments.addAll([
                    "-DCMAKE_JOB_POOLS=native_compile=1",
                    "-DCMAKE_JOB_POOL_COMPILE=native_compile"
                ])
            }
        }
    }
}
`;
            // React Native's root plugin evaluates :app while it is applied.
            const rootPlugin = /^apply plugin:/m;
            if (!rootPlugin.test(config.modResults.contents)) {
                throw new Error('Cannot register native compiler pool before root plugins');
            }
            config.modResults.contents = config.modResults.contents.replace(
                rootPlugin,
                `${nativeCompileConfig}\napply plugin:`
            );
        }

        if (config.modResults.contents.includes('jvmTarget')) {
            return config // If it's already configured, skip
        }

        const newConfigurations = `
    tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).all {
        kotlinOptions {
            jvmTarget = "17"  // Ensure Kotlin targets JVM 17
        }
    }

    tasks.withType(JavaCompile).configureEach {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }`

        // Check if the file already has the gradle.projectsEvaluated block from withDetoxTestFix
        if (config.modResults.contents.includes('gradle.projectsEvaluated')) {
            // We need to find the main allprojects block, not the one inside gradle.projectsEvaluated
            const allProjectsRegex = /allprojects\s*\{(?!\s*tasks\.withType\(com\.android\.build\.gradle)/g;
            const matches = [...config.modResults.contents.matchAll(allProjectsRegex)];
            
            // Find the main allprojects block (not the one inside gradle.projectsEvaluated)
            const mainAllProjectsMatch = matches.find(match => {
                const blockStart = match.index + match[0].length;
                const blockText = config.modResults.contents.substring(blockStart, blockStart + 100);
                return blockText.includes('repositories') || blockText.includes('maven');
            });
            
            if (mainAllProjectsMatch) {
                const blockStart = mainAllProjectsMatch.index + mainAllProjectsMatch[0].length;
                const blockEnd = findClosingBrace(config.modResults.contents, blockStart);
                
                if (blockEnd !== -1) {
                    const existingBlock = config.modResults.contents.substring(blockStart, blockEnd);
                    const updatedAllProjects = `allprojects {${existingBlock}
${newConfigurations}
}`;
                    config.modResults.contents = 
                        config.modResults.contents.substring(0, mainAllProjectsMatch.index) +
                        updatedAllProjects +
                        config.modResults.contents.substring(blockEnd + 1);
                }
            } else {
                // If we can't find the main allprojects block, add a new one after gradle.projectsEvaluated
                const gradleEvalBlock = /gradle\.projectsEvaluated\s*\{[\s\S]*?\}\s*\}/g;
                const gradleEvalMatch = gradleEvalBlock.exec(config.modResults.contents);
                
                if (gradleEvalMatch) {
                    const blockEnd = gradleEvalMatch.index + gradleEvalMatch[0].length;
                    
                    config.modResults.contents = 
                        config.modResults.contents.substring(0, blockEnd) +
                        `

allprojects {
    repositories {
        // Repositories will be added by React Native
    }
${newConfigurations}
}` +
                        config.modResults.contents.substring(blockEnd);
                }
            }
        } else {
            // Original behavior when there's no gradle.projectsEvaluated block
            const allProjectsRegex = /allprojects\s*\{/g;
            const match = allProjectsRegex.exec(config.modResults.contents);

            if (match) {
                // If allprojects block exists, append new configurations to it
                const blockStart = match.index + match[0].length;
                const blockEnd = findClosingBrace(config.modResults.contents, blockStart);

                if (blockEnd !== -1) {
                    const existingBlock = config.modResults.contents.substring(blockStart, blockEnd);
                    const updatedAllProjects = `allprojects {${existingBlock}
${newConfigurations}
}`;
                    config.modResults.contents =
                        config.modResults.contents.substring(0, match.index) +
                        updatedAllProjects +
                        config.modResults.contents.substring(blockEnd + 1);
                }
            } else {
                // If allprojects block doesn't exist, append a new one
                config.modResults.contents += `

allprojects {
${newConfigurations}
}`;
            }
        }

        return config;
    });
    
    // Then, handle the gradle.properties modifications
    config = withGradleProperties(config, (config) => {
        // The correct way to modify gradle properties
        // Gradle properties are stored as an array of key-value pairs
        const gradleProperties = config.modResults;
        
        // Helper function to set or update a property
        const setProperty = (key, value) => {
            const index = gradleProperties.findIndex(prop => prop.key === key);
            if (index !== -1) {
                gradleProperties[index].value = value;
            } else {
                gradleProperties.push({ key, value, type: 'property' });
            }
        };
        
        // Set the JVM arguments with increased memory settings
        setProperty('org.gradle.jvmargs', '-Xmx8g -XX:MaxMetaspaceSize=4096m -XX:+HeapDumpOnOutOfMemoryError');
        setProperty('org.gradle.parallel', 'true');
        // EAS overrides parallel/jvmargs, but does not set a worker limit.
        setProperty('org.gradle.workers.max', '1');
        // Avoid retaining a separate Kotlin compiler heap during native builds.
        setProperty('kotlin.compiler.execution.strategy', 'in-process');
        setProperty('org.gradle.daemon', 'true');
        setProperty('org.gradle.configureondemand', 'true');
        setProperty('org.gradle.caching', 'true');
        return config;
    });

    // Keep Android debug-only manifest tweaks in one durable place so prebuild
    // regeneration doesn't wipe them.
    config = withDangerousMod(config, [
        'android',
        async (config) => {
            const debugManifestDir = path.join(
                config.modRequest.platformProjectRoot,
                'app',
                'src',
                'debug'
            )

            fs.mkdirSync(debugManifestDir, { recursive: true })

            const debugManifestPath = path.join(
                debugManifestDir,
                'AndroidManifest.xml'
            )

            fs.writeFileSync(
                debugManifestPath,
                `<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    xmlns:tools="http://schemas.android.com/tools">

    <uses-sdk tools:overrideLibrary="net.siteed.moonshine,ai.moonshine.voice" />

    <uses-permission android:name="android.permission.SYSTEM_ALERT_WINDOW"/>

    <application android:usesCleartextTraffic="true" tools:targetApi="28" tools:ignore="GoogleAppIndexingWarning" tools:replace="android:usesCleartextTraffic" />
</manifest>
`
            )

            return config
        },
    ])

    return config;
}

// Function to find the matching closing brace
function findClosingBrace(str, startIndex) {
    let braceCount = 1
    for (let i = startIndex; i < str.length; i++) {
        if (str[i] === '{') braceCount++
        if (str[i] === '}') braceCount--
        if (braceCount === 0) return i
    }
    return -1
}

// FIXME: it creates the below instead of adding to existing allProjects block

// // Top-level build file where you can add configuration options common to all sub-projects/modules.

// buildscript {
//     ext {
//         buildToolsVersion = findProperty('android.buildToolsVersion') ?: '34.0.0'
//         minSdkVersion = Integer.parseInt(findProperty('android.minSdkVersion') ?: '23')
//         compileSdkVersion = Integer.parseInt(findProperty('android.compileSdkVersion') ?: '34')
//         targetSdkVersion = Integer.parseInt(findProperty('android.targetSdkVersion') ?: '34')
//         kotlinVersion = findProperty('android.kotlinVersion') ?: '1.9.23'

//         ndkVersion = "26.1.10909125"
//     }
//     repositories {
//         google()
//         mavenCentral()
//     }
//     dependencies {
//         classpath('com.android.tools.build:gradle')
//         classpath('com.facebook.react:react-native-gradle-plugin')
//         classpath('org.jetbrains.kotlin:kotlin-gradle-plugin')
//     }
// }

// apply plugin: "com.facebook.react.rootproject"

// allprojects {
//     repositories {
//         maven {
//             // All of React Native (JS, Obj-C sources, Android binaries) is installed from npm
//             url(new File(['node', '--print', "require.resolve('react-native/package.json')"].execute(null, rootDir).text.trim(), '../android'))
//         }
//         maven {
//             // Android JSC is installed from npm
//             url(new File(['node', '--print', "require.resolve('jsc-android/package.json', { paths: [require.resolve('react-native/package.json')] })"].execute(null, rootDir).text.trim(), '../dist'))
//         }

//         google()
//         mavenCentral()
//         maven { url 'https://www.jitpack.io' }
//     }
// }

// allprojects {
//     tasks.withType(org.jetbrains.kotlin.gradle.tasks.KotlinCompile).all {
//         kotlinOptions {
//             jvmTarget = "17"  // Ensure Kotlin targets JVM 17
//         }
//     }

//     java {
//         toolchain {
//             languageVersion.set(JavaLanguageVersion.of(17))  // Ensure Java uses JVM 17 globally
//         }
//     }

//     tasks.withType(JavaCompile).configureEach {
//         sourceCompatibility = JavaVersion.VERSION_17
//         targetCompatibility = JavaVersion.VERSION_17
//     }
// }
