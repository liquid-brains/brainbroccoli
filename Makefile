BUILD_TARGET ?=

all: check $(BUILD_TARGET)

node_modules/.done: package.json package-lock.json
	npm ci
	@touch node_modules/.done

check: node_modules/.done
	npm run typecheck
	npm test

bundle-android: node_modules/.done
	npm run bundle:android

bundle-linux: node_modules/.done
	npm run bundle:linux

run-linux: bundle-linux
	npm run linux

apk: node_modules/.done
	npx expo prebuild --platform android --no-install
	cd android && ./gradlew --build-cache assembleRelease

ipa: node_modules/.done
	npx expo prebuild --platform ios --no-install
	cd ios && pod install && xcodebuild -workspace BrainBroccoli.xcworkspace -scheme BrainBroccoli -configuration Release -sdk iphoneos -derivedDataPath ../.xcode-derived-data CODE_SIGNING_ALLOWED=NO build

clean:
	rm -rf dist dist-linux dist-desktop android ios .xcode-derived-data

.PHONY: all check bundle-android bundle-linux run-linux apk ipa clean
