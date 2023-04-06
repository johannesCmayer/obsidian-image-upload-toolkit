import {App, Editor, FileSystemAdapter, MarkdownView, normalizePath, Notice,} from "obsidian";
import path from "path";
import ImageUploader from "./imageUploader";
import {PublishSettings} from "../publish";

const MD_REGEX = /\!\[(.*)\]\((.*?\.(png|jpg|jpeg|gif|svg|excalidraw))\)/g;
const WIKI_REGEX = /\!\[\[(.*?\.(png|jpg|jpeg|gif|svg|excalidraw))\]\]/g;

interface Image {
    name: string;
    path: string;
    url: string;
    source: string;
}

export const ACTION_PUBLISH: string = "PUBLISH";

export default class ImageTagProcessor {
    private app: App;
    private readonly imageUploader: ImageUploader;
    private settings: PublishSettings;
    private adapter: FileSystemAdapter;

    constructor(app: App, settings: PublishSettings, imageUploader: ImageUploader) {
        this.app = app;
        this.adapter = this.app.vault.adapter as FileSystemAdapter;
        this.settings = settings;
        this.imageUploader = imageUploader;
    }

    public async process(action: string): Promise<void> {
        let value = this.getValue();
        const basePath = this.adapter.getBasePath();
        const promises: Promise<Image>[] = []
        const images = this.getImageLists(value);
        const uploader = this.imageUploader;
        for (const image of images) {
            if ((await this.app.vault.getAbstractFileByPath(normalizePath(image.path))) == null) {
                new Notice(`Can NOT locate ${image.name} with ${image.path}, please check image path or attachment option in plugin setting!`, 10000);
                console.log(`${normalizePath(image.path)} not exist`);
                break;
            }
            const buf = await this.adapter.readBinary(image.path);
            promises.push(new Promise(function (resolve) {
                uploader.upload(new File([buf], image.name), basePath + '/' + image.path).then(imgUrl => {
                    image.url = imgUrl;
                    resolve(image)
                }).catch(e => new Notice(`Upload ${image.path} failed, remote server returned an error: ${e.message}`, 10000))
            }));
        }

        return promises.length >= 0 && Promise.all(promises).then(images => {
            let altText;
            for (const image of images) {
                altText = this.settings.imageAltText ? path.parse(image.name)?.name?.replaceAll("-", " ")?.replaceAll("_", " ") : '';
                console.log(`replacing ${image.source} with ![${altText}](${image.url})`);
                value = value.replaceAll(image.source, `![${altText}](${image.url})`);
            }

            // Replace wiki links with markdown links from frontmatter of the linked files
            const file = app.workspace.getActiveFile();
            let fmc = app.metadataCache.getFileCache(file)?.links;
            for (let x of fmc) {
                let f = app.metadataCache.getFirstLinkpathDest(x.link, x.link);
                let del_link = false;
                if (f == null) {
                    new Notice(`Can NOT locate file for link ${x.link}! Deleting link in export.`, 10000);
                    del_link = true;
                }
                let fm = app.metadataCache.getFileCache(f)?.frontmatter;
                if (fm == undefined) {
                    new Notice(`${f.name} has no frontmatter! Deleting link in export.`, 10000);
                    del_link = true;
                }
                if (fm['link'] == undefined) {
                    new Notice(`${f.name} frontmatter has no link field in! Deleting link in export.`, 10000);
                    del_link = true;
                }
                if (del_link) {
                    value = value.replaceAll(x.original, x.displayText);
                    continue;
                }
                value = value.replaceAll(x.original, `[${x.displayText}](${fm['link']})`);
            }

            if (this.settings.replaceOriginalDoc) {
                this.getEditor()?.setValue(value);
            }
            switch (action) {
                case ACTION_PUBLISH:
                    navigator.clipboard.writeText(value);
                    new Notice("Copied to clipboard");
                    break;
                // more cases
                default:
                    throw new Error("invalid action!")
            }
        })
    }

    private getImageLists(value: string): Image[] {
        const images: Image[] = [];
        const wikiMatches = value.matchAll(WIKI_REGEX);
        const mdMatches = value.matchAll(MD_REGEX);
        for (const match of wikiMatches) {
            const name = match[1]
            var path_name = name
            if (name.endsWith('.excalidraw')) {
                path_name = name + '.png'
            }
            images.push({
                name: name,
                path: this.settings.attachmentLocation + '/' + path_name,
                source: match[0],
                url: '',
            })
        }
        for (const match of mdMatches) {
            if (match[2].startsWith('http://') || match[2].startsWith('https://')) {
                continue
            }
            const decodedPath = decodeURI(match[2]);
            images.push({
                name: match[1] || path.parse(decodedPath).name,
                path: this.settings.attachmentLocation + '/' + decodedPath,
                source: match[0],
                url: '',
            })
        }
        return images;
    }


    private getValue(): string {
        const editor = this.getEditor();
        if (editor) {
            return editor.getValue()
        } else {
            return ""
        }
    }

    private getEditor(): Editor {
        const activeView = this.app.workspace.activeEditor;
        if (activeView) {
            return activeView.editor
        } else {
            return null
        }
    }
}