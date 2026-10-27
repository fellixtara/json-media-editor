=== JSON Media Editor ===
Contributors: fellixtara
Tags: json, media, editor, unicorn studio, lottie
Requires at least: 5.9
Tested up to: 7.1
Requires PHP: 7.4
Stable tag: 1.1.0
License: GPLv2 or later
License URI: https://www.gnu.org/licenses/gpl-2.0.html

Edit JSON files from the Media Library directly in the dashboard and customize their images, fonts, files and texts, without downloading and re-uploading.

== Description ==

Animation tools such as Unicorn Studio or Lottie load their scenes from a JSON file uploaded to the Media Library. Changing an image in such an animation normally means downloading the JSON, editing a URL and uploading it again.

JSON Media Editor lets you do it in place:

1. Go to **Media > JSON Editor**. Only JSON files from the Media Library are listed.
2. Click **Select** next to a file.
3. Change an image, font, file or text in the **Customizable content** panel, or edit the JSON directly. The JSON is shown indented for readability — only whitespace changes, never the data.
4. Click **Save JSON**. The file is overwritten at the same URL, so the animation uses it immediately.

Features:

* Lists JSON attachments only (detected by `.json` extension, any MIME type).
* Customizable content panel, grouped by layer, detected automatically:
  * Images (preview + Media Library picker; keeps `naturalWidth` / `naturalHeight` in sync for Unicorn Studio image layers).
  * Fonts (.ttf, .otf, .woff, .woff2) with a live preview; font family names in the same layer stay in sync.
  * Other media files (video, audio, JSON, 3D models).
  * Texts (e.g. Unicorn Studio `textContent`, Lottie text) and their style: font family, size, weight, line height, letter spacing, alignment, color and text box size — including per-breakpoint values.
* Allows .ttf, .otf, .woff and .woff2 uploads to the Media Library (disable with the `jme_allow_font_uploads` filter).
* WordPress code editor with JSON syntax highlighting, linting and folding.
* Validation in the browser and on the server — invalid JSON is never written.
* Optional compact save, matching the original minified format.
* Automatic backups of the last 5 versions with one-click restore.
* Front-end cache busting: URLs of edited JSON files in post content and Elementor output get `?ver=<save time>` so visitors don't see a cached animation.
* Multisite compatible (works per site).

Access requires the `upload_files` capability and permission to edit the attachment.

== Changelog ==

= 1.1.0 =
* Detect fonts, other media files and texts (with typography and breakpoint values) in addition to images.
* Text styles grouped by the screen sizes where each value is used (Unicorn Studio breakpoint rules); duplicate unused copies and font family names are shown once and kept in sync.
* Allow font uploads to the Media Library.

= 1.0.0 =
* Initial release.
