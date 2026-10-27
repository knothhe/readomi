.DEFAULT_GOAL := help

RELEASE_COMMAND ?= node scripts/release.mjs
VERSION_BUMP ?= patch
RELEASE_FLAGS ?=
INSTALL_COMMAND ?= node scripts/install-local.mjs
INSTALL_FLAGS ?=
RELEASE_REPO ?=
RELEASE_TAG ?=

.PHONY: help release release-initial release-chrome release-notes install zip

help:
	@printf '%s\n' \
	  'make release                       Preview the next patch release' \
	  'make release VERSION_BUMP=minor     Preview a minor, major or exact version' \
	  'make release RELEASE_FLAGS=--apply  Check, commit, tag and push the release' \
	  'make release-initial               Preview publishing the current version' \
	  'make install                       Build and sync the configured local extension' \
	  'make install INSTALL_FLAGS=firefox  Build and install for Firefox' \
	  'make zip                           Build a Chrome extension ZIP' \
	  'make release-chrome                Rebuild and upload Chrome ZIP to an existing Release' \
	  'make --silent release-notes RELEASE_REPO=owner/repo RELEASE_TAG=v1.2.3'

release:
	$(RELEASE_COMMAND) "$(VERSION_BUMP)" $(RELEASE_FLAGS)

release-initial:
	$(RELEASE_COMMAND) initial $(RELEASE_FLAGS)

install:
	$(INSTALL_COMMAND) $(INSTALL_FLAGS)

zip:
	pnpm zip

release-chrome:
	bash scripts/release-chrome.sh

release-notes:
	@node scripts/release-notes.mjs "$(RELEASE_REPO)" "$(RELEASE_TAG)"
