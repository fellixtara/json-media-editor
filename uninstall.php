<?php
/**
 * Remove plugin data on uninstall.
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'WP_UNINSTALL_PLUGIN' ) ) {
	exit;
}

/**
 * Delete the version option and file backups for the current site.
 */
function jme_uninstall_site() {
	delete_option( 'jme_file_versions' );
	delete_post_meta_by_key( '_jme_backups' );
}

if ( is_multisite() ) {
	foreach ( get_sites( array( 'fields' => 'ids', 'number' => 0 ) ) as $jme_site_id ) {
		switch_to_blog( $jme_site_id );
		jme_uninstall_site();
		restore_current_blog();
	}
} else {
	jme_uninstall_site();
}
