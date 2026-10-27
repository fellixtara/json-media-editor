<?php
/**
 * Plugin Name:       JSON Media Editor
 * Description:       Edit JSON files from the Media Library directly in the dashboard (e.g. Unicorn Studio / Lottie animation files) and customize their images, fonts, files and texts without downloading and re-uploading.
 * Version:           1.1.0
 * Requires at least: 5.9
 * Requires PHP:      7.4
 * Author:            Djavaweb
 * Author URI:        https://djavaweb.com/
 * License:           GPL v2 or later
 * License URI:       https://www.gnu.org/licenses/gpl-2.0.html
 * Text Domain:       json-media-editor
 * Domain Path:       /languages
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

define( 'JME_VERSION', '1.1.0' );
define( 'JME_FILE', __FILE__ );
define( 'JME_DIR', plugin_dir_path( __FILE__ ) );
define( 'JME_URL', plugin_dir_url( __FILE__ ) );

require_once JME_DIR . 'includes/class-jme-files.php';
require_once JME_DIR . 'includes/class-jme-admin.php';
require_once JME_DIR . 'includes/class-jme-frontend.php';
require_once JME_DIR . 'includes/class-jme-uploads.php';

add_action(
	'plugins_loaded',
	static function () {
		load_plugin_textdomain( 'json-media-editor', false, dirname( plugin_basename( JME_FILE ) ) . '/languages' );

		JME_Frontend::init();
		JME_Uploads::init();

		if ( is_admin() ) {
			JME_Admin::init();
		}
	}
);
