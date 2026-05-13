# GA Manager - Cross-platform Build
#
# Usage:
#   make build-windows       # Windows amd64 (full, cross-compilable)
#   make build-mac-arm64     # macOS arm64 (requires building ON a Mac)
#   make build-mac-amd64     # macOS amd64 (requires building ON a Mac)
#   make build-backend-mac   # Backend only for macOS (cross-compilable from any OS)
#   make package             # ZIP all built artifacts
#   make clean               # Remove build artifacts
#
# NOTE: The desktop (systray) binary requires CGO on macOS (Cocoa framework).
#       It MUST be compiled on a Mac. The backend is pure Go and can be
#       cross-compiled from any platform.

VERSION ?= $(shell git describe --tags --always 2>/dev/null || echo "dev")
BUILD_DIR = build
FRONTEND_DIR = frontend
BACKEND_DIR = backend
DESKTOP_DIR = desktop

# Frontend build (shared across all platforms)
.PHONY: frontend
frontend:
	cd $(FRONTEND_DIR) && npm install && npm run build
	@echo ">> Copying frontend dist to backend/static..."
	rm -rf $(BACKEND_DIR)/static
	cp -r $(FRONTEND_DIR)/dist $(BACKEND_DIR)/static

# --- Windows amd64 (full, works from any OS) ---
.PHONY: build-windows
build-windows: frontend
	@echo ">> Building for Windows amd64..."
	@mkdir -p $(BUILD_DIR)/windows-amd64
	cd $(BACKEND_DIR) && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/windows-amd64/ga_manager.exe .
	cd $(DESKTOP_DIR) && GOOS=windows GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w -H windowsgui" -o ../$(BUILD_DIR)/windows-amd64/ga-manager-desktop.exe .
	cp -r $(BACKEND_DIR)/bridge $(BUILD_DIR)/windows-amd64/bridge
	@echo ">> Windows build complete: $(BUILD_DIR)/windows-amd64/"

# --- macOS arm64 (Apple Silicon) - MUST run on Mac ---
.PHONY: build-mac-arm64
build-mac-arm64: frontend
	@echo ">> Building for macOS arm64 (must run on Mac)..."
	@mkdir -p $(BUILD_DIR)/darwin-arm64
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-arm64/ga_manager .
	cd $(DESKTOP_DIR) && GOOS=darwin GOARCH=arm64 CGO_ENABLED=1 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-arm64/ga-manager-desktop .
	cp -r $(BACKEND_DIR)/bridge $(BUILD_DIR)/darwin-arm64/bridge
	@echo ">> macOS arm64 build complete: $(BUILD_DIR)/darwin-arm64/"

# --- macOS amd64 (Intel) - MUST run on Mac ---
.PHONY: build-mac-amd64
build-mac-amd64: frontend
	@echo ">> Building for macOS amd64 (must run on Mac)..."
	@mkdir -p $(BUILD_DIR)/darwin-amd64
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-amd64/ga_manager .
	cd $(DESKTOP_DIR) && GOOS=darwin GOARCH=amd64 CGO_ENABLED=1 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-amd64/ga-manager-desktop .
	cp -r $(BACKEND_DIR)/bridge $(BUILD_DIR)/darwin-amd64/bridge
	@echo ">> macOS amd64 build complete: $(BUILD_DIR)/darwin-amd64/"

# --- Backend-only for macOS (cross-compilable from Windows/Linux) ---
.PHONY: build-backend-mac
build-backend-mac: frontend
	@echo ">> Building backend only for macOS (cross-compile OK)..."
	@mkdir -p $(BUILD_DIR)/darwin-arm64 $(BUILD_DIR)/darwin-amd64
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=arm64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-arm64/ga_manager .
	cd $(BACKEND_DIR) && GOOS=darwin GOARCH=amd64 CGO_ENABLED=0 go build -ldflags="-s -w" -o ../$(BUILD_DIR)/darwin-amd64/ga_manager .
	cp -r $(BACKEND_DIR)/bridge $(BUILD_DIR)/darwin-arm64/bridge
	cp -r $(BACKEND_DIR)/bridge $(BUILD_DIR)/darwin-amd64/bridge
	@echo ">> Backend cross-compile complete. Desktop must be built on Mac."

# --- Package into ZIP ---
.PHONY: package
package:
	@echo ">> Packaging releases..."
	cd $(BUILD_DIR) && [ -d windows-amd64 ] && zip -r ga-manager-$(VERSION)-windows-amd64.zip windows-amd64/ || true
	cd $(BUILD_DIR) && [ -d darwin-arm64 ] && zip -r ga-manager-$(VERSION)-darwin-arm64.zip darwin-arm64/ || true
	cd $(BUILD_DIR) && [ -d darwin-amd64 ] && zip -r ga-manager-$(VERSION)-darwin-amd64.zip darwin-amd64/ || true
	@echo ">> Packages ready in $(BUILD_DIR)/"

# --- Clean ---
.PHONY: clean
clean:
	rm -rf $(BUILD_DIR)
	@echo ">> Cleaned build directory"
