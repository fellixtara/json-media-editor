# JSON Media Editor

A WordPress plugin for editing JSON files in the Media Library from the dashboard. You don't need to download the file, edit it and upload it again.

It's built for animation tools that load their scene from an uploaded JSON file, such as **Unicorn Studio** (`data-us-project-src`) or **Lottie**. To change an image in the animation, pick a new one and click **Save**. The file is overwritten at the same URL, so the animation updates right away.

## Features

- **JSON files only.** The picker lists Media Library attachments with a `.json` extension, whatever their MIME type.
- **Images panel.** Every image URL in the file is shown with a preview. You can replace it from the Media Library or paste a URL. For Unicorn Studio image layers, `naturalWidth` / `naturalHeight` are updated to match the new image.
- **Readable editor.** Minified JSON is shown indented in the WordPress code editor (CodeMirror), with syntax highlighting, linting and folding. Only whitespace changes, so the data stays the same.
- **Compact save.** By default the file is saved minified, like the original. Opening a file and saving it without changes gives a byte-identical file.
- **Validation.** Invalid JSON is rejected in the browser and again on the server, so a broken file is never written.
- **Backups.** The last 5 versions are kept automatically and can be restored with one click.
- **Cache busting.** URLs of edited JSON files in post content and Elementor output get `?ver=<save time>`, so visitors don't see a cached animation.
- **Multisite.** Works per site on WordPress Multisite.
- **Access.** Users need the `upload_files` capability and permission to edit the attachment. Every action is nonce-protected.

## Requirements

- WordPress 5.9 or later
- PHP 7.4 or later

## Installation

1. Copy the `json-media-editor` folder to `wp-content/plugins/`, or upload it as a ZIP under **Plugins → Add New → Upload Plugin**.
2. Activate **JSON Media Editor**.

## Usage

1. Go to **Media → JSON Editor**. You can also use the **Edit JSON** link on a JSON file in the Media Library list view.
2. Click **Select** next to the file you want to edit.
3. In **Images**, click **Choose image** or paste a new URL. You can also edit the JSON directly in the editor.
4. Click **Save JSON**.

Example: on a page whose hero section loads `.../uploads/2026/06/hoverreveal.json` through Unicorn Studio, swapping the image in the editor and saving changes the image-reveal animation straight away.

## Developer hooks

```php
// Runs after a JSON file has been saved or restored, e.g. to purge a page cache.
add_action( 'jme_json_saved', function ( $attachment_id, $path ) {
	// ...
}, 10, 2 );
```

## File structure

```
json-media-editor/
├── json-media-editor.php        Plugin bootstrap
├── includes/
│   ├── class-jme-files.php      Scanning, reading, validation, saving, backups
│   ├── class-jme-admin.php      Media → JSON Editor screens and save/restore handlers
│   └── class-jme-frontend.php   ?ver= cache busting on the front end
├── assets/
│   ├── admin.js                 Editor, images panel, validation
│   └── admin.css
├── readme.txt                   WordPress.org readme
└── uninstall.php                Removes plugin data (option + backups)
```

## Uninstall

Deleting the plugin removes its version option and the stored backups on every site. Your JSON files are left as they are.

## Author

[Djavaweb](https://djavaweb.com/). Contributor: [fellixtara](https://github.com/fellixtara)

## License

GPL v2 or later. See <https://www.gnu.org/licenses/gpl-2.0.html>.
