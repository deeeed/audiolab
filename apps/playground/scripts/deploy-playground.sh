#!/bin/bash

# Colors for better readability
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Ensure we exit on errors
set -e

# Change to the project root directory
cd "$(dirname "$0")/.."
PROJECT_ROOT=$(pwd)

echo -e "${BLUE}===================================================${NC}"
echo -e "${BLUE}       📱 AudioPlayground Deployment Script 📱      ${NC}"
echo -e "${BLUE}===================================================${NC}"

# Define constants
CHANGELOG_FILE="CHANGELOG.md"

# Function to clear caches thoroughly
clear_all_caches() {
  echo -e "\n${CYAN}Clearing all caches for fresh build...${NC}"
  
  # Clear yarn cache
  yarn clean
  
  # Clear Metro cache
  if [ -d "node_modules/.cache" ]; then
    echo -e "${YELLOW}Removing Metro bundler cache...${NC}"
    rm -rf node_modules/.cache
  fi
  
  # Clear Expo cache directories if they exist
  if [ -d ".expo" ]; then
    echo -e "${YELLOW}Removing Expo cache...${NC}"
    rm -rf .expo
  fi
  
  # Clear build directories
  if [ -d "dist" ]; then
    echo -e "${YELLOW}Removing dist directory...${NC}"
    rm -rf dist
  fi
  
  echo -e "${GREEN}✅ All caches cleared successfully!${NC}"
}

# Function to update version in package.json and app.config.ts
update_version() {
  # Get current version from package.json
  CURRENT_VERSION=$(grep -o '"version": "[^"]*' package.json | cut -d'"' -f4)
  # Get package name from package.json
  PACKAGE_NAME=$(grep -o '"name": "[^"]*' package.json | cut -d'"' -f4)
  echo -e "${CYAN}Current version: ${GREEN}$CURRENT_VERSION${NC}"
  echo -e "${CYAN}Package name: ${GREEN}$PACKAGE_NAME${NC}"

  # Ask if user wants to update version - default to Yes
  read -p "$(echo -e ${YELLOW}"Do you want to update the version before publishing? (Y/n): "${NC})" UPDATE_VERSION
  UPDATE_VERSION=${UPDATE_VERSION:-y}  # Default to yes

  if [[ "$UPDATE_VERSION" != "y" && "$UPDATE_VERSION" != "Y" ]]; then
    echo -e "${CYAN}Version update skipped. Continuing with current version.${NC}"
    # Check if the current version is in the changelog
    check_changelog "$CURRENT_VERSION"
    return
  fi

  # Parse current version
  IFS='.' read -r MAJOR MINOR PATCH <<< "$CURRENT_VERSION"
  
  # Calculate next versions
  NEXT_MAJOR="$((MAJOR+1)).0.0"
  NEXT_MINOR="$MAJOR.$((MINOR+1)).0"
  NEXT_PATCH="$MAJOR.$MINOR.$((PATCH+1))"

  # Display version options
  echo -e "\n${CYAN}Select new version:${NC}"
  echo -e "1. ${GREEN}$NEXT_PATCH${NC} (Patch - for bug fixes)"
  echo -e "2. ${GREEN}$NEXT_MINOR${NC} (Minor - for new features)"
  echo -e "3. ${GREEN}$NEXT_MAJOR${NC} (Major - for breaking changes)"
  echo -e "4. Custom version"

  # Set default version based on platform
  local default_choice=1
  if [[ "$PLATFORM_CHOICE" == "2" || "$PLATFORM_CHOICE" == "3" ]]; then
    # For Android or iOS, default to minor version update (needed for runtime updates)
    default_choice=2
    echo -e "${CYAN}Note: Native builds typically require at least a minor version update for OTA compatibility${NC}"
  fi

  # Ask user to select version
  read -p "$(echo -e ${YELLOW}"Enter your choice [$default_choice]: "${NC})" VERSION_CHOICE
  VERSION_CHOICE=${VERSION_CHOICE:-$default_choice}  # Default based on platform

  case $VERSION_CHOICE in
    1)
      NEW_VERSION=$NEXT_PATCH
      ;;
    2)
      NEW_VERSION=$NEXT_MINOR
      ;;
    3)
      NEW_VERSION=$NEXT_MAJOR
      ;;
    4)
      read -p "$(echo -e ${YELLOW}"Enter custom version (format: x.y.z): "${NC})" NEW_VERSION
      if ! [[ $NEW_VERSION =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]]; then
        echo -e "${RED}Invalid version format. Please use x.y.z format where x, y, z are numbers.${NC}"
        exit 1
      fi
      ;;
    *)
      if [[ "$PLATFORM_CHOICE" == "2" || "$PLATFORM_CHOICE" == "3" ]]; then
        echo -e "${RED}Invalid choice. Using minor version.${NC}"
        NEW_VERSION=$NEXT_MINOR
      else
        echo -e "${RED}Invalid choice. Using patch version.${NC}"
        NEW_VERSION=$NEXT_PATCH
      fi
      ;;
  esac

  # Confirm version update
  read -p "$(echo -e ${YELLOW}"Update version from $CURRENT_VERSION to $NEW_VERSION? (Y/n): "${NC})" CONFIRM_UPDATE
  CONFIRM_UPDATE=${CONFIRM_UPDATE:-y}  # Default to yes

  if [[ "$CONFIRM_UPDATE" != "y" && "$CONFIRM_UPDATE" != "Y" ]]; then
    echo -e "${RED}Version update cancelled.${NC}"
    exit 0
  fi

  # Check if the new version is in the changelog
  if ! grep -q "## \[$NEW_VERSION\]" "$CHANGELOG_FILE"; then
    echo -e "${RED}❌ WARNING: Version $NEW_VERSION is not documented in CHANGELOG.md${NC}"
    
    # Run the changelog helper to show what's changed
    echo -e "${CYAN}Here are the changes since the last version:${NC}"
    bash "$(dirname "$0")/update-changelog.sh" "$NEW_VERSION"
    
    echo -e "\n${YELLOW}What would you like to do?${NC}"
    echo -e "1. ${YELLOW}Pause to update CHANGELOG.md manually${NC} (recommended)"
    echo -e "2. ${YELLOW}Continue without changelog entry${NC} (not recommended)"
    echo -e "3. ${RED}Cancel deployment${NC}"
    
    read -p "$(echo -e ${YELLOW}"Enter your choice [1]: "${NC})" CHANGELOG_CHOICE
    CHANGELOG_CHOICE=${CHANGELOG_CHOICE:-1}
    
    case $CHANGELOG_CHOICE in
      1)
        echo -e "\n${CYAN}Please update CHANGELOG.md now with the new version.${NC}"
        echo -e "${CYAN}Press Enter when you have updated the changelog...${NC}"
        read
        
        # Check if it was added successfully
        if ! grep -q "## \[$NEW_VERSION\]" "$CHANGELOG_FILE"; then
          echo -e "${RED}Version $NEW_VERSION still not found in CHANGELOG.md${NC}"
          echo -e "${YELLOW}Continue anyway? (y/N): ${NC}"
          read CONTINUE_ANYWAY
          if [[ "$CONTINUE_ANYWAY" != "y" && "$CONTINUE_ANYWAY" != "Y" ]]; then
            echo -e "${RED}Deployment cancelled.${NC}"
            exit 1
          fi
        else
          echo -e "${GREEN}✅ Version $NEW_VERSION found in changelog.${NC}"
        fi
        ;;
      2)
        echo -e "${YELLOW}Continuing without changelog entry. Consider updating the changelog later.${NC}"
        ;;
      3|*)
        echo -e "${RED}Deployment cancelled.${NC}"
        exit 0
        ;;
    esac
  fi

  # Update package.json
  sed -i '' "s/\"version\": \"$CURRENT_VERSION\"/\"version\": \"$NEW_VERSION\"/" package.json

  # Update app.config.ts
  sed -i '' "s/runtimeVersion: '[^']*'/runtimeVersion: '$NEW_VERSION'/" app.config.ts

  echo -e "${GREEN}✅ Version updated to $NEW_VERSION in package.json and app.config.ts${NC}"

  # Ask if user wants to commit changes
  read -p "$(echo -e ${YELLOW}"Commit version changes to git? (Y/n): "${NC})" COMMIT_CHANGES
  COMMIT_CHANGES=${COMMIT_CHANGES:-y}  # Default to yes

  if [[ "$COMMIT_CHANGES" == "y" || "$COMMIT_CHANGES" == "Y" ]]; then
    git add package.json app.config.ts CHANGELOG.md
    git commit -m "chore: bump version to $NEW_VERSION"
    
    # Ask if user wants to tag this version
    read -p "$(echo -e ${YELLOW}"Tag this version in git? (Y/n): "${NC})" TAG_VERSION
    TAG_VERSION=${TAG_VERSION:-y}  # Default to yes
    
    if [[ "$TAG_VERSION" == "y" || "$TAG_VERSION" == "Y" ]]; then
      TAG_NAME="$PACKAGE_NAME@$NEW_VERSION"
      git tag -a "$TAG_NAME" -m "Version $NEW_VERSION"
      echo -e "${GREEN}✅ Created git tag $TAG_NAME${NC}"
      
      read -p "$(echo -e ${YELLOW}"Push tag to remote? (Y/n): "${NC})" PUSH_TAG
      PUSH_TAG=${PUSH_TAG:-y}  # Default to yes
      
      if [[ "$PUSH_TAG" == "y" || "$PUSH_TAG" == "Y" ]]; then
        git push origin "$TAG_NAME"
        echo -e "${GREEN}✅ Pushed tag to remote${NC}"
      fi
    fi
    
    echo -e "${GREEN}✅ Changes committed to git${NC}"
  fi
}

# Function to check if version exists in changelog
check_changelog() {
  local VERSION=$1
  local CHANGELOG_FILE="CHANGELOG.md"
  
  # Check if changelog file exists
  if [ ! -f "$CHANGELOG_FILE" ]; then
    echo -e "${RED}❌ ERROR: CHANGELOG.md does not exist.${NC}"
    echo -e "${YELLOW}Please run 'bash $(dirname "$0")/update-changelog.sh init' to create it.${NC}"
    exit 1
  fi
  
  # Check if the version is in the changelog
  if ! grep -q "## \[$VERSION\]" "$CHANGELOG_FILE"; then
    echo -e "${RED}❌ ERROR: Version $VERSION is not documented in CHANGELOG.md${NC}"
    echo -e "${YELLOW}Please update the changelog before deployment:${NC}"
    echo -e "${CYAN}  bash $(dirname "$0")/update-changelog.sh auto $VERSION${NC}"
    echo -e "${CYAN}  bash $(dirname "$0")/update-changelog.sh manual $VERSION${NC}"
    exit 1
  fi
  
  echo -e "${GREEN}✅ Version $VERSION found in CHANGELOG.md${NC}"
}

# Helper: find and submit the latest local build artifact
# Usage: submit_local_build <platform>  (platform = ios or android)
submit_local_build() {
  local platform="$1"
  local ext artifact version build_info

  if [[ "$platform" == "ios" ]]; then
    ext="ipa"
  else
    ext="aab"
  fi

  # Find the most recent artifact in the current directory
  artifact="$(find . -maxdepth 1 -name "*.${ext}" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -n1)"

  if [[ -z "$artifact" ]]; then
    echo -e "${RED}No .${ext} file found in $(pwd)${NC}"
    echo -e "${YELLOW}Build locally first (option 3) or check your working directory.${NC}"
    return 1
  fi

  echo -e "\n${CYAN}Found artifact: ${GREEN}$(basename "$artifact")${NC}"
  echo -e "${CYAN}Size: ${GREEN}$(du -h "$artifact" | cut -f1)${NC}"

  # Extract version info from the artifact
  if [[ "$platform" == "ios" ]]; then
    build_info=$(unzip -p "$artifact" "Payload/*.app/Info.plist" 2>/dev/null | plutil -p - 2>/dev/null || true)
    if [[ -n "$build_info" ]]; then
      version=$(echo "$build_info" | grep '"CFBundleShortVersionString"' | sed 's/.*=> "\(.*\)"/\1/')
      local build_num=$(echo "$build_info" | grep '"CFBundleVersion"' | sed 's/.*=> "\(.*\)"/\1/')
      echo -e "${CYAN}Version: ${GREEN}${version}${NC}  Build: ${GREEN}${build_num}${NC}"
    else
      echo -e "${YELLOW}Could not extract version info from .ipa${NC}"
    fi
  else
    if command -v aapt2 &>/dev/null; then
      build_info=$(aapt2 dump badging "$artifact" 2>/dev/null | head -1 || true)
    elif command -v aapt &>/dev/null; then
      build_info=$(aapt dump badging "$artifact" 2>/dev/null | head -1 || true)
    fi
    if [[ -n "$build_info" ]]; then
      version=$(echo "$build_info" | grep -o "versionName='[^']*'" | cut -d"'" -f2)
      local version_code=$(echo "$build_info" | grep -o "versionCode='[^']*'" | cut -d"'" -f2)
      echo -e "${CYAN}Version: ${GREEN}${version}${NC}  VersionCode: ${GREEN}${version_code}${NC}"
    else
      echo -e "${YELLOW}Could not extract version info from .aab (aapt/aapt2 not found)${NC}"
    fi
  fi

  read -p "$(echo -e ${YELLOW}"Submit this artifact? (Y/n): "${NC})" CONFIRM_SUBMIT
  CONFIRM_SUBMIT=${CONFIRM_SUBMIT:-y}

  if [[ "$CONFIRM_SUBMIT" != "y" && "$CONFIRM_SUBMIT" != "Y" ]]; then
    echo -e "${RED}Submission cancelled.${NC}"
    return 1
  fi

  echo -e "${CYAN}Submitting to $([ "$platform" == "ios" ] && echo "App Store" || echo "Play Store")...${NC}"
  if [[ "$platform" == "ios" ]]; then
    (
      source .env.production 2>/dev/null || true
      yarn dlx eas-cli submit --platform ios --path "$artifact"
    )
  else
    yarn dlx eas-cli submit --platform android --path "$artifact"
  fi
}

# Deploy to web function
deploy_web() {
  echo -e "\n${CYAN}Preparing web deployment...${NC}"
  read -p "$(echo -e ${YELLOW}"Choose environment (development/production) [production]: "${NC})" WEB_ENV
  WEB_ENV=${WEB_ENV:-production}

  # Clear caches first
  clear_all_caches

  if [[ "$WEB_ENV" == "development" ]]; then
    echo -e "${CYAN}Deploying to web (development)...${NC}"
    NODE_ENV=development APP_VARIANT=development EXPO_WEB=true yarn expo export -p web
    if [ ! -d "dist" ]; then
      echo -e "${RED}❌ Export failed: dist/ directory not found${NC}"
      return 1
    fi
    yarn serve dist/
  else
    echo -e "${CYAN}Deploying to web (production)...${NC}"
    NODE_ENV=production APP_VARIANT=production EXPO_WEB=true yarn expo export -p web
    if [ ! -d "dist" ]; then
      echo -e "${RED}❌ Export failed: dist/ directory not found${NC}"
      return 1
    fi
    cp playstore_policy.html dist/
    # Override LFS tracking for binary assets: GitHub Pages serves raw git
    # objects and cannot resolve LFS pointers, so we must store these files
    # directly in git on the gh-pages branch.
    cat > dist/.gitattributes <<'GITATTR'
*.onnx -filter=lfs -diff=lfs -merge=lfs -text
*.wasm -filter=lfs -diff=lfs -merge=lfs -text
GITATTR
    echo -e "${CYAN}Publishing to gh-pages...${NC}"
    yarn gh-pages -t -d dist --dest playground
    if [ $? -ne 0 ]; then
      echo -e "${RED}❌ gh-pages publish failed${NC}"
      return 1
    fi
  fi

  echo -e "${GREEN}✅ Web deployment completed!${NC}"
}

# Deploy to Android function
deploy_android() {
  echo -e "\n${CYAN}Android deployment options:${NC}"
  echo -e "1. ${GREEN}Development${NC} (local debug APK)"
  echo -e "2. ${GREEN}Preview${NC} (local optimized, unsigned APK)"
  echo -e "3. ${GREEN}Preview APK${NC} (local optimized APK for distribution)"
  echo -e "4. ${GREEN}Production${NC} (local optimized, signed AAB)"
  echo -e "5. ${GREEN}Production + Submit${NC} (remote build; exceeds the EAS plan time limit, prefer 4)"
  echo -e "6. ${GREEN}Submit Local Build${NC} (submit most recent local .aab to Play Store)"

  read -p "$(echo -e ${YELLOW}"Choose Android build type [4]: "${NC})" ANDROID_CHOICE
  ANDROID_CHOICE=${ANDROID_CHOICE:-4}  # Default to the local production build (see PUBLISH_STORE.md)
  
  # Clear caches first
  clear_all_caches
  
  case $ANDROID_CHOICE in
    1)
      echo -e "${CYAN}Building Android development version...${NC}"
      yarn build:android:development
      ;;
    2)
      echo -e "${CYAN}Building Android preview version...${NC}"
      yarn build:android:preview
      ;;
    3)
      echo -e "${CYAN}Building Android preview APK version...${NC}"
      yarn build:android:preview_apk
      ;;
    4)
      echo -e "${CYAN}Ensuring production workspace...${NC}"
      yarn setup:production
      echo -e "${CYAN}Building Android production version locally...${NC}"
      nice -n 15 env GRADLE_OPTS="-Dorg.gradle.workers.max=4" yarn build:android:production --local --no-wait

      read -p "$(echo -e ${YELLOW}"Do you want to submit this build to the Play Store? (Y/n): "${NC})" SUBMIT_ANDROID
      SUBMIT_ANDROID=${SUBMIT_ANDROID:-y}  # Default to yes

      if [[ "$SUBMIT_ANDROID" == "y" || "$SUBMIT_ANDROID" == "Y" ]]; then
        submit_local_build android
      fi
      ;;
    5)
      echo -e "${CYAN}Building and submitting Android production version to Play Store...${NC}"
      yarn build:android:production --auto-submit
      ;;
    6)
      submit_local_build android
      ;;
    *)
      echo -e "${RED}Invalid choice. Run the script again and pick a build type.${NC}"
      exit 1
      ;;
  esac
  
  echo -e "${GREEN}✅ Android deployment process completed!${NC}"
}

# Deploy to iOS function
deploy_ios() {
  echo -e "\n${CYAN}iOS deployment options:${NC}"
  echo -e "1. ${GREEN}Development${NC} (local build for registered devices)"
  echo -e "2. ${GREEN}Preview${NC} (local build for simulator/TestFlight)"
  echo -e "3. ${GREEN}Production${NC} (local production build)"
  echo -e "4. ${GREEN}Production + Submit${NC} (remote build with auto-submit to App Store)"
  echo -e "5. ${GREEN}Submit Local Build${NC} (submit most recent local .ipa to App Store)"
  
  read -p "$(echo -e ${YELLOW}"Choose iOS build type [4]: "${NC})" IOS_CHOICE
  IOS_CHOICE=${IOS_CHOICE:-4}  # Default to production + submit
  
  # Clear caches first
  clear_all_caches
  
  case $IOS_CHOICE in
    1)
      echo -e "${CYAN}Building iOS development version...${NC}"
      read -p "$(echo -e ${YELLOW}"Do you need to register test devices first? (y/n) [n]: "${NC})" REGISTER_DEVICES
      REGISTER_DEVICES=${REGISTER_DEVICES:-n}
      
      if [[ "$REGISTER_DEVICES" == "y" || "$REGISTER_DEVICES" == "Y" ]]; then
        yarn dlx eas-cli device:create
      fi
      yarn build:ios:development
      ;;
    2)
      echo -e "${CYAN}Building iOS preview version...${NC}"
      yarn build:ios:preview
      ;;
    3)
      echo -e "${CYAN}Ensuring production iOS workspace...${NC}"
      yarn setup:production
      echo -e "${CYAN}Building iOS production version locally...${NC}"
      yarn build:ios:production --local

      read -p "$(echo -e ${YELLOW}"Do you want to submit this build to the App Store? (Y/n): "${NC})" SUBMIT_IOS
      SUBMIT_IOS=${SUBMIT_IOS:-y}  # Default to yes

      if [[ "$SUBMIT_IOS" == "y" || "$SUBMIT_IOS" == "Y" ]]; then
        submit_local_build ios
      fi
      ;;
    4)
      echo -e "${CYAN}Building and submitting iOS production version to App Store...${NC}"
      yarn build:ios:production --auto-submit
      ;;
    5)
      submit_local_build ios
      ;;
    *)
      echo -e "${RED}Invalid choice. Using Production + Submit.${NC}"
      yarn build:ios:production --auto-submit
      ;;
  esac
  
  echo -e "${GREEN}✅ iOS deployment process completed!${NC}"
}

# OTA Update function
push_update() {
  echo -e "\n${CYAN}Pushing OTA update...${NC}"
  read -p "$(echo -e ${YELLOW}"Enter update message: "${NC})" UPDATE_MESSAGE
  
  # Clear caches first
  clear_all_caches
  
  echo -e "${CYAN}Reinstalling dependencies...${NC}"
  yarn install
  
  echo -e "${CYAN}Pushing update with message: ${UPDATE_MESSAGE}${NC}"
  yarn dlx eas-cli update --message "$UPDATE_MESSAGE"
  
  echo -e "${GREEN}✅ Update pushed successfully!${NC}"
}

# Main execution flow
echo -e "${CYAN}This script will help you deploy AudioPlayground to various platforms.${NC}"

# Get package name from package.json
PACKAGE_NAME=$(grep -o '"name": "[^"]*' package.json | cut -d'"' -f4)

# Ask for deployment platform
echo -e "\n${CYAN}Select deployment platform:${NC}"
echo -e "1. ${GREEN}Web${NC}"
echo -e "2. ${GREEN}Android${NC}"
echo -e "3. ${GREEN}iOS${NC}"
echo -e "4. ${GREEN}Push OTA Update${NC}"
echo -e "5. ${GREEN}Manage Changelog${NC}"

read -p "$(echo -e ${YELLOW}"Enter your choice [1]: "${NC})" PLATFORM_CHOICE
PLATFORM_CHOICE=${PLATFORM_CHOICE:-1}  # Default to web

# If user chose to manage changelog, run that script instead
if [[ "$PLATFORM_CHOICE" == "5" ]]; then
  bash "$(dirname "$0")/update-changelog.sh"
  exit 0
fi

# Check if there's at least one version tag
if [ -z "$(git tag | grep "^$PACKAGE_NAME@")" ]; then
  echo -e "\n${YELLOW}No $PACKAGE_NAME version tags found. Initializing changelog...${NC}"
  bash "$(dirname "$0")/update-changelog.sh" init
fi

# Update version first (after platform selection to determine default version increment)
update_version

case $PLATFORM_CHOICE in
  1)
    deploy_web
    ;;
  2)
    deploy_android
    ;;
  3)
    deploy_ios
    ;;
  4)
    push_update
    ;;
  *)
    echo -e "${RED}Invalid choice. Defaulting to Web deployment.${NC}"
    deploy_web
    ;;
esac

echo -e "\n${GREEN}🎉 Deployment completed successfully! 🎉${NC}"
