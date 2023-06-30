import {  MarkdownView, PluginManifest, TextFileView } from 'obsidian';
import { ExportSettings } from '../export-settings';
import { Path } from './path';
import { RenderLog } from '../html-generation/render-log';
import { Downloadable } from './downloadable';

/* @ts-ignore */
const dialog: Electron.Dialog = require('electron').remote.dialog;

export class Utils
{
	static async uploadNotebookToNetlify(fileToOpen: string)
	{
		const AdmZip = require('adm-zip');
		const zip = new AdmZip();
		zip.addLocalFolder(ExportSettings.settings.netlifyNotebookPath);
		const buffer = zip.toBuffer();

		const https = require('https');

		var notebookUrl = "";
		var deployId = "";
		var request = https.request({
			hostname: 'api.netlify.com',
			port: 443,
			path: '/api/v1/sites/' + ExportSettings.settings.netlifySiteId + '/deploys',
			method: 'POST',
			headers: {
				'Content-Type': 'application/zip',
				'Content-Disposition': 'attachment; filename=example.zip',
				'Authorization': 'Bearer '+ExportSettings.settings.netlifyAPIToken
		}
		}, (res:any) => {
			res.on('data', async (d:any) =>  {
				(d.toString())
				var jsonResponse = JSON.parse(d.toString())
				if ("url" in jsonResponse) {
					notebookUrl = jsonResponse.url
					deployId = jsonResponse.id

					var notebookPublished = false
					while (!notebookPublished) {
						var request = https.request({
							hostname: 'api.netlify.com',
							port: 443,
							path: '/api/v1/deploys/'+deployId,
							method: 'GET',
							headers: {
								'Authorization': 'Bearer '+ExportSettings.settings.netlifyAPIToken
							}
						}, (res:any) => {						
							res.on('data', (d:any) => {
								(d.toString())
								try {
									var jsonResponse = JSON.parse(d.toString())
									if ("state" in jsonResponse && jsonResponse.state === "ready") {
										if (fileToOpen && notebookUrl){
											open(notebookUrl+"/"+fileToOpen)
										}
										notebookPublished = true
									}
								} catch (error) {
									
								}
							});
						})
			
						request.on('error', (e:any) => {
							// console.error(e);
						});
			
						request.end();
						await Utils.delay(1000)
					}
				}
			});
		});

		request.on('error', (error:any) => {
			console.error(error);
		});

		request.write(buffer);
		request.end();
	}

	static async delay (ms: number)
	{
		return new Promise( resolve => setTimeout(resolve, ms) );
	}

	static padStringBeggining(str: string, length: number, char: string)
	{
		return char.repeat(length - str.length) + str;
	}

	static sampleCSSColorHex(variable: string, testParentEl: HTMLElement): { a: number, hex: string }
	{
		let testEl = document.createElement('div');
		testEl.style.setProperty('display', 'none');
		testEl.style.setProperty('color', 'var(' + variable + ')');
		testParentEl.appendChild(testEl);

		let col = getComputedStyle(testEl).color;
		let opacity = getComputedStyle(testEl).opacity;

		testEl.remove();

		function toColorObject(str: string)
		{
			var match = str.match(/rgb?\((\d+),\s*(\d+),\s*(\d+)\)/);
			return match ? {
				red: parseInt(match[1]),
				green: parseInt(match[2]),
				blue: parseInt(match[3]),
				alpha: 1
			} : null
		}

		var color = toColorObject(col), alpha = parseFloat(opacity);
		return isNaN(alpha) && (alpha = 1),
		color ? {
			a: alpha * color.alpha,
			hex: Utils.padStringBeggining(color.red.toString(16), 2, "0") + Utils.padStringBeggining(color.green.toString(16), 2, "0") + Utils.padStringBeggining(color.blue.toString(16), 2, "0")
		} : {
			a: alpha,
			hex: "ffffff"
		}
	};

	static async changeViewMode(view: MarkdownView, modeName: "preview" | "source")
	{
		/*@ts-ignore*/
		const mode = view.modes[modeName]; 
		/*@ts-ignore*/
		mode && await view.setMode(mode);
	};

	static async showSaveDialog(defaultPath: Path, defaultFileName: string, showAllFilesOption: boolean = true): Promise<Path | undefined>
	{
		// get paths
		let absoluteDefaultPath = defaultPath.directory.absolute().joinString(defaultFileName);
		
		// add filters
		let filters = [{
			name: Utils.trimStart(absoluteDefaultPath.extenstion, ".").toUpperCase() + " Files",
			extensions: [Utils.trimStart(absoluteDefaultPath.extenstion, ".")]
		}];

		if (showAllFilesOption)
		{
			filters.push({
				name: "All Files",
				extensions: ["*"]
			});
		}

		// show picker
		let picker = await dialog.showSaveDialog({
			defaultPath: absoluteDefaultPath.asString,
			filters: filters,
			properties: ["showOverwriteConfirmation"]
		})

		if (picker.canceled) return undefined;
		
		let pickedPath = new Path(picker.filePath);
		ExportSettings.settings.lastExportPath = pickedPath.asString;
		ExportSettings.saveSettings();
		
		return pickedPath;
	}

	static async showSelectFolderDialog(defaultPath: Path): Promise<Path | undefined>
	{
		if(!defaultPath.exists) defaultPath = Path.vaultPath;

		// show picker
		let picker = await dialog.showOpenDialog({
			defaultPath: defaultPath.directory.asString,
			properties: ["openDirectory"]
		});

		if (picker.canceled) return undefined;

		let path = new Path(picker.filePaths[0]);
		ExportSettings.settings.lastExportPath = path.directory.asString;
		ExportSettings.saveSettings();

		return path;
	}

	static idealDefaultPath() : Path
	{
		let lastPath = new Path(ExportSettings.settings.lastExportPath);

		if (lastPath.asString != "" && lastPath.exists)
		{
			return lastPath.directory;
		}

		return Path.vaultPath;
	}

	static async downloadFiles(files: Downloadable[], folderPath: Path)
	{
		if (!folderPath.isAbsolute) throw new Error("folderPath must be absolute: " + folderPath.asString);

		RenderLog.progress(0, files.length, "Saving HTML files to disk", "...", "var(--color-green)")
		
		for (let i = 0; i < files.length; i++)
		{
			let file = files[i];

			try
			{
				await file.download(folderPath.directory);
				RenderLog.progress(i+1, files.length, "Saving HTML files to disk", "Saving: " + file.filename, "var(--color-green)");
			}
			catch (e)
			{
				RenderLog.error("Could not save file: " + file.filename, e.stack);
				continue;
			}
		}
		
	}

	//async function that awaits until a condition is met
	static async waitUntil(condition: () => boolean, timeout: number = 1000, interval: number = 100): Promise<boolean>
	{
		return new Promise((resolve, reject) => {
			let timer = 0;
			let intervalId = setInterval(() => {
				if (condition()) {
					clearInterval(intervalId);
					resolve(true);
				} else {
					timer += interval;
					if (timer >= timeout) {
						clearInterval(intervalId);
						resolve(false);
					}
				}
			}, interval);
		});
	}

	static getPluginIDs(): string[]
	{
		/*@ts-ignore*/
		let pluginsArray: string[] = Array.from(app.plugins.enabledPlugins.values()) as string[];
		for (let i = 0; i < pluginsArray.length; i++)
		{
			/*@ts-ignore*/
			if (app.plugins.manifests[pluginsArray[i]] == undefined)
			{
				pluginsArray.splice(i, 1);
				i--;
			}
		}

		return pluginsArray;
	}

	static getPluginManifest(pluginID: string): PluginManifest | null
	{
		// @ts-ignore
		return app.plugins.manifests[pluginID] ?? null;
	}

	static getActiveTextView(): TextFileView | null
	{
		let view = app.workspace.getActiveViewOfType(TextFileView);
		if (!view)
		{
			return null;
		}

		return view;
	}

	static trimEnd(inputString: string, trimString: string): string
	{
		if (inputString.endsWith(trimString))
		{
			return inputString.substring(0, inputString.length - trimString.length);
		}

		return inputString;
	}

	static trimStart(inputString: string, trimString: string): string
	{
		if (inputString.startsWith(trimString))
		{
			return inputString.substring(trimString.length);
		}

		return inputString;
	}
}
