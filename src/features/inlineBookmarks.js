"use strict";
/**
 * @author github.com/tintinweb
 *
 *
 *
 * */
/** imports */
const vscode = require("vscode");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const settings = require("../settings");
const os = require("os");

class Commands {
    constructor(controller) {
        this.controller = controller;
    }

    refresh() {
        Object.keys(this.controller.bookmarks).forEach((uri) => {
            vscode.workspace.openTextDocument(vscode.Uri.parse(uri)).then((document) => {
                this.controller.updateBookmarks(document);
            });
        }, this);
    }

    showSelectBookmark(filter, placeHolder) {
        let entries = [];

        // Step 1: Get list of open tab file paths if the setting is enabled
        let visibleEditorUris = [];
        if (settings.extensionConfig().view.showVisibleFilesOnly) {
            visibleEditorUris = vscode.window.tabGroups.all
                .map((group) => group.tabs)
                .flat()
                .map((tab) => {
                    if (tab.input instanceof vscode.TabInputText) {
                        return tab.input.uri.fsPath;
                    } else if (tab.input instanceof vscode.TabInputTextDiff) {
                        // Include both original and modified files in case of diff editors
                        return [tab.input.modified.fsPath, tab.input.original.fsPath];
                    }
                    return null;
                })
                .flat()
                .filter((path) => path !== null);
        }

        // Step 2: Modify the loop to filter files based on the setting
        Object.keys(this.controller.bookmarks).forEach((uri) => {
            let resource = vscode.Uri.parse(uri);
            let resourceFsPath = resource.fsPath;
            let fname = path.parse(resourceFsPath).base;

            // Filter out files not in open tabs if the setting is enabled
            if (settings.extensionConfig().view.showVisibleFilesOnly) {
                if (!visibleEditorUris.includes(resourceFsPath)) {
                    return; // Skip this file
                }
            }

            if (filter && !filter(resourceFsPath)) {
                return;
            }

            Object.keys(this.controller.bookmarks[uri]).forEach((cat) => {
                this.controller.bookmarks[uri][cat].forEach((b) => {
                    entries.push({
                        label: `${fname}: ${b.text}`,
                        text: b.text,
                        word: b.word,
                        description: fname,
                        target: new vscode.Location(resource, b.range),
                        filename: fname,
                        filepath: resourceFsPath,
                        uri: resource,
                        isFilenameEntry: false,
                    });
                });
            });
        }, this);

        // Sort entries first by filename, then by word, then by label
        entries.sort((a, b) => {
            if (a.filepath < b.filepath) return -1;
            if (a.filepath > b.filepath) return 1;
            if (a.filename < b.filename) return -1;
            if (a.filename > b.filename) return 1;
            if (a.word < b.word) return -1;
            if (a.word > b.word) return 1;
            if (a.label < b.label) return -1;
            if (a.label > b.label) return 1;
            return 0;
        });

        // Step 1: Collect all unique file paths
        let filePaths = [...new Set(entries.map((entry) => entry.filepath))];

        // Step 2: Find the common root path
        function getCommonPath(paths) {
            if (!paths || paths.length === 0) {
                return "";
            }
            const splitPaths = paths.map((p) => p.split(path.sep));
            const minLen = Math.min(...splitPaths.map((parts) => parts.length));
            let commonParts = [];
            for (let i = 0; i < minLen; i++) {
                const part = splitPaths[0][i];
                if (splitPaths.every((parts) => parts[i] === part)) {
                    commonParts.push(part);
                } else {
                    break;
                }
            }
            return commonParts.length > 0 ? commonParts.join(path.sep) + path.sep : "";
        }

        let commonRoot = getCommonPath(filePaths);

        // Step 3: Compute relative paths and add 'relativePath' to entries
        entries.forEach((entry) => {
            const relativePath = path.relative(commonRoot, entry.filepath);
            entry.relativePath = relativePath;
        });

        // Step 4: Create newEntries with the relative paths
        let newEntries = [];
        let currentRelativePath = null;

        entries.forEach((entry) => {
            if (currentRelativePath !== entry.relativePath) {
                // Relative path has changed; add a filename entry
                currentRelativePath = entry.relativePath;
                newEntries.push({
                    label: currentRelativePath, // Use relative path as the label
                    isFilenameEntry: true,
                    filename: entry.filename,
                    uri: entry.uri, // Save the URI to open the file
                });
            }

            // Add the bookmark entry with indentation and without filename prefix
            newEntries.push({
                ...entry,
                label: "    " + entry.text.trim(), // Indent label
                isFilenameEntry: false,
            });
        });

        // Use newEntries for QuickPick
        vscode.window.showQuickPick(newEntries, { placeHolder: placeHolder || "Select bookmarks" }).then((item) => {
            if (item) {
                if (item.isFilenameEntry) {
                    // Open the file
                    vscode.workspace.openTextDocument(item.uri).then((doc) => {
                        vscode.window.showTextDocument(doc);
                    });
                } else {
                    // Jump to the range
                    vscode.commands.executeCommand("inlineBookmarks.jumpToRange", item.target.uri, item.target.range);
                }
            }
        });
    }

    showSelectVisibleBookmark() {
        let visibleEditorUris = vscode.window.visibleTextEditors.map((te) => te.document.uri.fsPath);
        this.showSelectBookmark((resFsPath) => visibleEditorUris.includes(resFsPath), "Select visible bookmarks");
    }

    showListBookmarks(filter) {
        if (!vscode.window.outputChannel) {
            vscode.window.outputChannel = vscode.window.createOutputChannel("inlineBookmarks");
        }

        if (!vscode.window.outputChannel) return;
        vscode.window.outputChannel.clear();

        let entries = [];
        Object.keys(this.controller.bookmarks).forEach((uri) => {
            let resource = vscode.Uri.parse(uri).fsPath;
            let fname = path.parse(resource).base;

            if (filter && !filter(resource)) {
                return;
            }

            Object.keys(this.controller.bookmarks[uri]).forEach((cat) => {
                this.controller.bookmarks[uri][cat].forEach((b) => {
                    entries.push({
                        label: b.text,
                        word: b.word,
                        description: fname,
                        target: new vscode.Location(resource, b.range),
                    });
                });
            });
        }, this);

        if (entries.length === 0) {
            vscode.window.showInformationMessage("No results");
            return;
        }

        var useNewMethod = false;

        if (useNewMethod) {
            // Create a new list with concatenated 'label' and no 'word' field
            entries = entries.map((entry) => ({
                label: `${entry.word}: ${entry.label}`,
                description: entry.description,
                target: entry.target,
            }));
        }

        entries.forEach(function (v, i, a) {
            var patternA = "#" + (i + 1) + "\t" + v.target.uri + "#" + (v.target.range.start.line + 1);
            var patternB =
                "#" + (i + 1) + "\t" + v.target.uri + ":" + (v.target.range.start.line + 1) + ":" + (v.target.range.start.character + 1);
            var patterns = [patternA, patternB];

            var patternType = 0;
            if (os.platform() == "linux") {
                patternType = 1;
            }
            patternType = +!patternType;

            vscode.window.outputChannel.appendLine(patterns[patternType]);
            vscode.window.outputChannel.appendLine("\t" + v.label + "\n");
        });
        vscode.window.outputChannel.show();
    }

    showListVisibleBookmarks() {
        let visibleEditorUris = vscode.window.visibleTextEditors.map((te) => te.document.uri.fsPath);
        this.showListBookmarks((resFsPath) => visibleEditorUris.includes(resFsPath));
    }

    scanWorkspaceBookmarks() {
        function arrayToSearchGlobPattern(config) {
            return Array.isArray(config) ? "{" + config.join(",") + "}" : typeof config == "string" ? config : "";
        }

        var includePattern = arrayToSearchGlobPattern(settings.extensionConfig().search.includes) || "{**/*}";
        var excludePattern = arrayToSearchGlobPattern(settings.extensionConfig().search.excludes);
        var limit = settings.extensionConfig().search.maxFiles;

        let that = this;

        vscode.workspace.findFiles(includePattern, excludePattern, limit).then(
            function (files) {
                if (!files || files.length === 0) {
                    console.log("No files found");
                    return;
                }

                var totalFiles = files.length;

                for (var i = 0; i < totalFiles; i++) {
                    vscode.workspace.openTextDocument(files[i]).then(
                        (document) => {
                            that.controller.updateBookmarks(document);
                            //NOP
                        },
                        (err) => {
                            console.error(err);
                        }
                    );
                }
            },
            (err) => {
                console.error(err);
            }
        );
    }
}

class InlineBookmarksCtrl {
    constructor(context) {
        this.context = context;
        this.styles = this._reLoadDecorations();
        this.words = this._reLoadWords();

        this.commands = new Commands(this);

        this.bookmarks = {}; // {file: {bookmark}}
        this.loadFromWorkspace();
    }

    /** -- public -- */

    hasBookmarks() {
        return !!this.bookmarks;
    }

    async decorate(editor) {
        if (!editor || !editor.document /*|| editor.document.fileName.startsWith("extension-output-")*/) return; //decorate list of inline comments

        this._clearBookmarksOfFile(editor.document);

        if (this._extensionIsBlacklisted(editor.document.fileName)) return;

        for (var style in this.words) {
            if (!this.words.hasOwnProperty(style) || this.words[style].length == 0 || this._wordIsOnIgnoreList(this.words[style])) {
                continue;
            }
            this._decorateWords(editor, this.words[style], style, editor.document.fileName.startsWith("extension-output-")); //don't add to bookmarks if we're decorating an extension-output
        }

        this.saveToWorkspace(); //update workspace
    }

    async updateBookmarks(document) {
        if (!document || document.fileName.startsWith("extension-output-")) return;

        this._clearBookmarksOfFile(document);

        if (this._extensionIsBlacklisted(document.fileName)) return;

        for (var style in this.words) {
            if (!this.words.hasOwnProperty(style) || this.words[style].length == 0 || this._wordIsOnIgnoreList(this.words[style])) {
                continue;
            }
            this._updateBookmarksForWordAndStyle(document, this.words[style], style);
        }

        this.saveToWorkspace(); //update workspace
    }

    /** -- private -- */

    _extensionIsBlacklisted(fileName) {
        let ignoreList = settings.extensionConfig().exceptions.file.extensions.ignore;
        if (!ignoreList || ignoreList.length === 0) return false;
        return this._commaSeparatedStringToUniqueList(ignoreList).some((ext) => fileName.endsWith(ext.trim()));
    }

    _wordIsOnIgnoreList(word) {
        let ignoreList = settings.extensionConfig().exceptions.words.ignore;
        return this._commaSeparatedStringToUniqueList(ignoreList).some((ignoreWord) => word.startsWith(ignoreWord.trim()));
    }

    _commaSeparatedStringToUniqueList(s) {
        if (!s) return [];
        return [
            ...new Set(
                s
                    .trim()
                    .split(",")
                    .map((e) => e.trim())
                    .filter((e) => e.length)
            ),
        ];
    }

    async _decorateWords(editor, words, style, noAdd) {
        const decoStyle = this.styles[style].type || this.styles["default"].type;

        let locations = this._findWords(editor.document, words);
        editor.setDecorations(decoStyle, locations); // set decorations

        if (locations.length && !noAdd) this._addBookmark(editor.document, style, locations);
    }

    async _updateBookmarksForWordAndStyle(document, words, style) {
        let locations = this._findWords(document, words);

        if (locations.length) this._addBookmark(document, style, locations);
    }

    _findWords(document, words) {
        const text = document.getText();
        var locations = [];

        words.forEach(function (word) {
            var regEx = new RegExp(word, "g");
            let match;
            while ((match = regEx.exec(text))) {
                var startPos = document.positionAt(match.index);
                var endPos = document.positionAt(match.index + match[0].trim().length);

                var fullLine = document.getWordRangeAtPosition(startPos, /(.+)$/);

                var decoration = {
                    range: new vscode.Range(startPos, endPos),
                    text: document.getText(new vscode.Range(startPos, fullLine.end)),
                    word: word,
                };

                locations.push(decoration);
            }
        });

        return locations;
    }

    _clearBookmarksOfFile(document) {
        let filename = document.uri;
        if (!this.bookmarks.hasOwnProperty(filename)) return;
        delete this.bookmarks[filename];
    }

    _clearBookmarksOfFileAndStyle(document, style) {
        let filename = document.uri;
        if (!this.bookmarks.hasOwnProperty(filename)) return;
        delete this.bookmarks[filename][style];
    }

    _addBookmark(document, style, locations) {
        let filename = document.uri;
        if (!this.bookmarks.hasOwnProperty(filename)) {
            this.bookmarks[filename] = {};
        }
        this.bookmarks[filename][style] = locations;
    }

    _reLoadWords() {
        let defaultWords = {
            // style: arr(regexWords)
            blue: this._commaSeparatedStringToUniqueList(settings.extensionConfig().default.words.blue),
            purple: this._commaSeparatedStringToUniqueList(settings.extensionConfig().default.words.purple),
            green: this._commaSeparatedStringToUniqueList(settings.extensionConfig().default.words.green),
            red: this._commaSeparatedStringToUniqueList(settings.extensionConfig().default.words.red),
        };

        return { ...defaultWords, ...settings.extensionConfig().expert.custom.words.mapping };
    }

    _getBookmarkDataUri(color) {
        return vscode.Uri.parse(
            "data:image/svg+xml," +
                encodeURIComponent(
                    `<svg version="1" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" enable-background="new 0 0 48 48"><path fill="${color}" d="M37,43l-13-6l-13,6V9c0-2.2,1.8-4,4-4h18c2.2,0,4,1.8,4,4V43z"/></svg>`
                )
        );
    }

    _getDecorationStyle(decoOptions) {
        return { type: vscode.window.createTextEditorDecorationType(decoOptions), options: decoOptions };
    }

    _getDecorationDefaultStyle(color) {
        return this._getDecorationStyle({
            gutterIconPath: this._getBookmarkDataUri(color),
            overviewRulerColor: color + "B0", // this is safe/suitable for the defaults only.  Custom ruler color is handled below.
            light: {
                fontWeight: "bold",
            },
            dark: {
                color: "Chocolate",
            },
        });
    }

    _reLoadDecorations() {
        const blue = "#157EFB";
        const green = "#2FCE7C";
        const purple = "#C679E0";
        const red = "#F44336";
        let styles = {
            default: this._getDecorationDefaultStyle(blue),
            red: this._getDecorationDefaultStyle(red),
            blue: this._getDecorationDefaultStyle(blue),
            green: this._getDecorationDefaultStyle(green),
            purple: this._getDecorationDefaultStyle(purple),
        };

        let customStyles = settings.extensionConfig().expert.custom.styles;

        for (var decoId in customStyles) {
            if (!customStyles.hasOwnProperty(decoId)) {
                continue;
            }

            let decoOptions = { ...customStyles[decoId] };

            // default to blue if neither an icon path nor an icon color is specified
            if (!decoOptions.gutterIconPath) {
                decoOptions.gutterIconColor = decoOptions.gutterIconColor || blue;
            }

            //apply icon color if provided, otherwise fix the path
            decoOptions.gutterIconPath = decoOptions.gutterIconColor
                ? this._getBookmarkDataUri(decoOptions.gutterIconColor)
                : this.context.asAbsolutePath(decoOptions.gutterIconPath);

            //overview
            if (decoOptions.overviewRulerColor) {
                decoOptions.overviewRulerLane = vscode.OverviewRulerLane.Full;
            }
            //background color
            if (decoOptions.backgroundColor) {
                decoOptions.isWholeLine = true;
            }
            styles[decoId] = this._getDecorationStyle(decoOptions);
        }

        return styles;
    }

    _isWorkspaceAvailable() {
        //single or multi root
        return vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length >= 1;
    }

    resetWorkspace() {
        if (!this._isWorkspaceAvailable()) return; //cannot save
        this.context.workspaceState.update("bookmarks.object", "{}");
    }

    saveToWorkspace() {
        if (!this._isWorkspaceAvailable()) return; //cannot save
        this.context.workspaceState.update("bookmarks.object", JSON.stringify(this.bookmarks));
    }

    loadFromWorkspace() {
        if (!this._isWorkspaceAvailable()) return; //cannot load
        this.bookmarks = JSON.parse(this.context.workspaceState.get("bookmarks.object", "{}"));

        //remove all non existing files
        Object.keys(this.bookmarks).forEach((filepath) => {
            if (!fs.existsSync(vscode.Uri.parse(filepath).fsPath)) {
                delete this.bookmarks[filepath];
                return;
            }

            Object.keys(this.bookmarks[filepath]).forEach((cat) => {
                //for each category
                this.bookmarks[filepath][cat] = this.bookmarks[filepath][cat].map((decoObject) => {
                    //fix - rebuild range object (it is expected by other functions)
                    decoObject.range = new vscode.Range(
                        decoObject.range[0].line,
                        decoObject.range[0].character,
                        decoObject.range[1].line,
                        decoObject.range[1].character
                    );
                    return decoObject;
                });
            });
        });
    }
}

const NodeType = {
    FILE: 1,
    LOCATION: 2,
};

class InlineBookmarksDataModel {
    /** treedata model */

    constructor(controller) {
        this.controller = controller;
    }

    getRoot() {
        /** returns element */
        let fileBookmarks = Object.keys(this.controller.bookmarks);

        let visibleEditorUris = [];
        if (settings.extensionConfig().view.showVisibleFilesOnly) {
            visibleEditorUris = vscode.window.tabGroups.all
                .map((group) => group.tabs)
                .flat()
                .map((tab) => {
                    if (tab.input instanceof vscode.TabInputText) {
                        return tab.input.uri.path;
                    } else if (tab.input instanceof vscode.TabInputTextDiff) {
                        // Include both original and modified files in case of diff editors
                        return [tab.input.modified.path, tab.input.original.path];
                    }
                    return null;
                })
                .flat()
                .filter((path) => path !== null);
        } else {
            visibleEditorUris = vscode.workspace.textDocuments.map((doc) => doc.uri.path);
            // Shows only the currently active editor
            // visibleEditorUris = vscode.window.visibleTextEditors.map((te) => te.document.uri.path);
        }

        fileBookmarks = fileBookmarks.filter((v) => visibleEditorUris.includes(vscode.Uri.parse(v).path));

        return fileBookmarks.sort().map((v) => {
            const resourceUri = vscode.Uri.parse(v);
            const resourceFsPath = resourceUri.fsPath;
            // Compute the relative path from the workspace folder
            const relativePath = vscode.workspace.asRelativePath(resourceFsPath);
            return {
                resource: vscode.Uri.parse(v),
                tooltip: v,
                name: v,
                label: relativePath,
                type: NodeType.FILE,
                parent: null,
                iconPath: vscode.ThemeIcon.File,
                location: null,
            };
        });
    }

    getChildren(element) {
        switch (element.type) {
            case NodeType.FILE:
                let bookmarks = Object.keys(this.controller.bookmarks[element.name])
                    .map((cat) => {
                        //all categories
                        return this.controller.bookmarks[element.name][cat].map((v) => {
                            let location = new vscode.Location(element.resource, v.range);
                            return {
                                resource: element.resource,
                                location: location,
                                label: v.text.trim(),
                                name: v.text.trim(),
                                word: v.word.trim(),
                                type: NodeType.LOCATION,
                                category: cat,
                                parent: element,
                                iconPath: this.controller.styles[cat].options.gutterIconPath,
                            };
                        });
                    })
                    .flat(1);

                return bookmarks.sort((a, b) => a.location.range.start.line - b.location.range.start.line);
                break;
        }
    }

    /**
    Find previous and next of element (for goto_next, goto_previous)

    requires current element from tree
    */
    getNeighbors(element) {
        let ret = { previous: null, next: null };
        let parent = element.parent;
        if (!parent) {
            //fake the parent
            parent = { ...element }; //use parent or derive it from bookmark
            parent.type = NodeType.FILE;
            parent.name = element.resource;
        }

        //get all children
        let bookmarks = this.getChildren(parent);

        //lets track if we're at our element.
        let gotElement = false;

        for (let b of bookmarks) {
            // find element in list, note prevs, next
            if (!gotElement && JSON.stringify(b.location) == JSON.stringify(element.location)) {
                gotElement = true;
                continue;
            }
            if (!gotElement) {
                ret.previous = b;
            } else {
                ret.next = b;
                break;
            }
        }

        return ret;
    }
}

class InlineBookmarkTreeDataProvider {
    constructor(inlineBookmarksController) {
        this._onDidChangeTreeData = new vscode.EventEmitter();
        this.onDidChangeTreeData = this._onDidChangeTreeData.event;

        this.controller = inlineBookmarksController;
        this.model = new InlineBookmarksDataModel(inlineBookmarksController);

        this.filterTreeViewWords = [];
        this.gitIgnoreHandler = undefined;
    }

    /** events */

    /** methods */

    getChildren(element) {
        return this._filterTreeView(element ? this.model.getChildren(element) : this.model.getRoot());
    }

    getParent(element) {
        return element ? element.parent : element;
    }

    getTreeItem(element) {
        if (!element) {
            return element; // undef
        }
        let item = new vscode.TreeItem(
            this._formatLabel(element.label),
            element.type == NodeType.LOCATION
                ? 0
                : settings.extensionConfig().view.expanded
                ? vscode.TreeItemCollapsibleState.Expanded
                : vscode.TreeItemCollapsibleState.Collapsed
        );
        item.id = element.type == NodeType.LOCATION ? this._getId(element.location) : this._getId(element.resource);
        item.resourceUri = element.resource;
        item.iconPath = element.iconPath;
        item.command =
            element.type == NodeType.LOCATION && element.location
                ? {
                      command: "inlineBookmarks.jumpToRange",
                      arguments: [element.location.uri, element.location.range],
                      title: "JumpTo",
                  }
                : 0;
        return item;
    }

    /*
    Hash object to unique ID.
    */
    _getId(o) {
        return crypto.createHash("sha1").update(JSON.stringify(o)).digest("hex");
    }

    _formatLabel(label) {
        if (!settings.extensionConfig().view.words.hide || !label) {
            return label;
        }
        let words = Object.values(this.controller.words).flat(1);
        return words.reduce((prevs, word) => prevs.replace(new RegExp(word, "g"), ""), label); //replace tags in matches.
    }

    _filterTreeView(elements) {
        if (this.gitIgnoreHandler && this.gitIgnoreHandler.filter) {
            elements = elements.filter((e) => this.gitIgnoreHandler.filter(e.resource));
        }

        if (this.filterTreeViewWords && this.filterTreeViewWords.length) {
            elements = elements.filter((e) => this._recursiveWordsFilter(e));
        }

        return elements;
    }

    _recursiveWordsFilter(element) {
        // If the element is undefined or null, return false
        if (!element) {
            return false;
        }

        // Retrieve the list of filter words (regex patterns)
        const filterWords = this.filterTreeViewWords;

        // 1. Check for perfect match on WORD
        if (element.word) {
            for (let rx of filterWords) {
                if (element.word === rx) {
                    return true; // Perfect match on word
                }
            }
        }

        // 2. Check for regex match on WORD
        if (element.word) {
            for (let rx of filterWords) {
                try {
                    const wordRegex = new RegExp(rx);
                    if (wordRegex.test(element.word)) {
                        return true; // Regex match on word
                    }
                } catch (e) {
                    // Handle invalid regex pattern
                    continue; // Skip to the next regex if invalid
                }
            }
        }

        // 3. Check for regex match on LABEL
        if (element.label) {
            for (let rx of filterWords) {
                try {
                    const labelRegex = new RegExp(rx);
                    if (labelRegex.test(element.label)) {
                        return true; // Regex match on label
                    }
                } catch (e) {
                    // Handle invalid regex pattern
                    continue; // Skip to the next regex if invalid
                }
            }
        }

        // 4. Handle branches: recursively check children
        const children = this.model.getChildren(element);
        if (children && children.length > 0) {
            // Recursively filter children
            // Keep the branch if any child (or nested child) passes the filter
            for (let child of children) {
                if (this._recursiveWordsFilter(child)) {
                    return true; // At least one child passes the filter
                }
            }
        } else {
            return false; // No children, filter out this branch
        }

        // 5. No matches found; return false
        return false;
    }

    setTreeViewFilterWords(words) {
        this.filterTreeViewWords = words;
    }

    setTreeViewGitIgnoreHandler(gi) {
        this.gitIgnoreHandler = gi;
    }

    refresh() {
        this._onDidChangeTreeData.fire();
    }
}

module.exports = {
    InlineBookmarksCtrl: InlineBookmarksCtrl,
    InlineBookmarkTreeDataProvider: InlineBookmarkTreeDataProvider,
    NodeType: NodeType,
};
