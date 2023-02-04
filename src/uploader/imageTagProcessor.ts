import {App, Editor, FileSystemAdapter, MarkdownView, Notice,} from "obsidian";
import {join, parse} from "path";
import {existsSync, readFileSync} from "fs";
import ImageUploader from "./imageUploader";
import {PublishSettings} from "../publish";

const MD_REGEX = /\!\[(.*)\]\((.*?\.(png|jpg|jpeg|gif|svg))\)/g;
const WIKI_REGEX = /\!\[\[(.*?\.(png|jpg|jpeg|gif|svg))\]\]/g;

interface Image {
    name: string;
    path: string;
    url: string;
    source: string;
}

export const ACTION_PUBLISH: string = "PUBLISH";
export const ACTION_REPLACE: string = "PUBLISH";

export default class ImageTagProcessor {
    private app: App;
    private readonly imageUploader: ImageUploader;
    private settings: PublishSettings;

    constructor(app: App, settings: PublishSettings, imageUploader: ImageUploader) {
        this.app = app;
        this.settings = settings;
        this.imageUploader = imageUploader;
    }

    public async process(action: string): Promise<void> {
        let value = this.getValue();
        const promises: Promise<Image>[] = []
        const images = this.getImageLists(value);
        const uploader = this.imageUploader;
        for (const image of images) {
            if (!existsSync(image.path)) {
                new Notice(`Can NOT locate ${image.name} with ${image.path}, please check image path or attachment option in plugin setting`, 10000);
                console.log(`path: ${image.path}, exist: ${existsSync(image.path)}`);
                break;
            }
            const buf = readFileSync(image.path);
            promises.push(new Promise(function (resolve) {
                uploader.upload(new File([buf], image.name), image.path).then(imgUrl => {
                    image.url = imgUrl;
                    resolve(image)
                }).catch(e => new Notice(`Upload ${image.path} failed, remote server returned an error: ${e.message}`, 10000))
            }))
        }

        return promises.length >= 0 && Promise.all(promises).then(images => {
            for (const image of images) {
                console.log(`replacing ${image.source} with ![${image.name}](${image.url})`)
                value = value.replaceAll(image.source, `![${image.name}](${image.url})`)
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
        const basePath = (this.app.vault.adapter as FileSystemAdapter).getBasePath();
        const images: Image[] = [];
        const wikiMatches = value.matchAll(WIKI_REGEX);
        const mdMatches = value.matchAll(MD_REGEX);
        for (const match of wikiMatches) {
            images.push({
                name: match[1],
                path: join(basePath, this.settings.attachmentLocation, match[1]),
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
                name: match[1] || parse(decodedPath).name,
                path: join(basePath, this.settings.attachmentLocation, decodedPath),
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
        const activeView = this.app.workspace.getActiveViewOfType(MarkdownView);
        if (activeView) {
            return activeView.editor
        } else {
            return null
        }
    }
}