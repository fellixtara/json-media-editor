<?php
/**
 * JSON attachment lookup, reading, saving and backups.
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Data layer for JSON files stored in the Media Library.
 */
class JME_Files {

	/** Post meta key holding previous versions of a file. */
	const BACKUP_META = '_jme_backups';

	/** Option holding the cache-busting version per attachment ID. */
	const VERSION_OPTION = 'jme_file_versions';

	/** Number of backups kept per file. */
	const MAX_BACKUPS = 5;

	/** Largest file (bytes) the editor will open or save. */
	const MAX_SIZE = 10485760;

	/**
	 * Return all Media Library attachments whose file is a .json file.
	 *
	 * @return WP_Post[]
	 */
	public static function get_json_attachments() {
		$query = new WP_Query(
			array(
				'post_type'              => 'attachment',
				'post_status'            => 'inherit',
				'posts_per_page'         => 500,
				'orderby'                => 'date',
				'order'                  => 'DESC',
				'no_found_rows'          => true,
				'update_post_term_cache' => false,
				// Scan by file extension so JSON stored with any MIME type (application/json, text/plain...) is found.
				'meta_query'             => array( // phpcs:ignore WordPress.DB.SlowDBQuery.slow_db_query_meta_query
					array(
						'key'     => '_wp_attached_file',
						'value'   => '.json',
						'compare' => 'LIKE',
					),
				),
			)
		);

		return array_values(
			array_filter(
				$query->posts,
				static function ( $post ) {
					return self::is_json_attachment( $post->ID );
				}
			)
		);
	}

	/**
	 * Whether an attachment is a JSON file inside the uploads directory.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool
	 */
	public static function is_json_attachment( $attachment_id ) {
		if ( 'attachment' !== get_post_type( $attachment_id ) ) {
			return false;
		}

		$file = get_post_meta( $attachment_id, '_wp_attached_file', true );

		return is_string( $file ) && 'json' === strtolower( pathinfo( $file, PATHINFO_EXTENSION ) );
	}

	/**
	 * Absolute path of the attachment file, or WP_Error when it is not a safe, existing JSON file.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return string|WP_Error
	 */
	public static function get_path( $attachment_id ) {
		if ( ! self::is_json_attachment( $attachment_id ) ) {
			return new WP_Error( 'jme_not_json', __( 'This attachment is not a JSON file.', 'json-media-editor' ) );
		}

		$path    = get_attached_file( $attachment_id );
		$real    = $path ? realpath( $path ) : false;
		$uploads = wp_get_upload_dir();
		$base    = realpath( $uploads['basedir'] );

		if ( ! $real || ! $base || 0 !== strpos( wp_normalize_path( $real ), trailingslashit( wp_normalize_path( $base ) ) ) ) {
			return new WP_Error( 'jme_missing', __( 'The JSON file could not be found in the uploads folder.', 'json-media-editor' ) );
		}

		return $real;
	}

	/**
	 * Read the raw file contents.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return string|WP_Error
	 */
	public static function read( $attachment_id ) {
		$path = self::get_path( $attachment_id );
		if ( is_wp_error( $path ) ) {
			return $path;
		}

		if ( filesize( $path ) > self::MAX_SIZE ) {
			return new WP_Error( 'jme_too_large', __( 'The file is too large to edit in the browser.', 'json-media-editor' ) );
		}

		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}

		$contents = $fs->get_contents( $path );

		return false === $contents
			? new WP_Error( 'jme_read', __( 'The file could not be read.', 'json-media-editor' ) )
			: $contents;
	}

	/**
	 * Validate and write new contents, keeping a backup of the previous version.
	 *
	 * The contents are written exactly as given (no re-encoding on the server), so
	 * the browser stays in control of formatting and values are never altered by PHP.
	 *
	 * @param int    $attachment_id Attachment ID.
	 * @param string $contents      New JSON text.
	 * @return true|WP_Error
	 */
	public static function save( $attachment_id, $contents ) {
		$error = self::validate( $contents );
		if ( is_wp_error( $error ) ) {
			return $error;
		}

		$path = self::get_path( $attachment_id );
		if ( is_wp_error( $path ) ) {
			return $path;
		}

		$fs = self::filesystem();
		if ( is_wp_error( $fs ) ) {
			return $fs;
		}

		$previous = $fs->get_contents( $path );
		if ( false !== $previous && $previous !== $contents ) {
			self::add_backup( $attachment_id, $previous );
		}

		if ( ! $fs->put_contents( $path, $contents, FS_CHMOD_FILE ) ) {
			return new WP_Error( 'jme_write', __( 'The file could not be written. Check the folder permissions.', 'json-media-editor' ) );
		}

		clearstatcache( true, $path );
		self::bump_version( $attachment_id );

		$meta = wp_get_attachment_metadata( $attachment_id );
		$meta = is_array( $meta ) ? $meta : array();

		$meta['filesize'] = strlen( $contents );
		wp_update_attachment_metadata( $attachment_id, $meta );

		/**
		 * Fires after a JSON media file has been saved, e.g. to purge page caches.
		 *
		 * @param int    $attachment_id Attachment ID.
		 * @param string $path          Absolute file path.
		 */
		do_action( 'jme_json_saved', $attachment_id, $path );

		return true;
	}

	/**
	 * Check that a string is valid JSON within the size limit.
	 *
	 * @param string $contents JSON text.
	 * @return true|WP_Error
	 */
	public static function validate( $contents ) {
		if ( ! is_string( $contents ) || '' === trim( $contents ) ) {
			return new WP_Error( 'jme_empty', __( 'The JSON content is empty.', 'json-media-editor' ) );
		}

		if ( strlen( $contents ) > self::MAX_SIZE ) {
			return new WP_Error( 'jme_too_large', __( 'The JSON content is too large.', 'json-media-editor' ) );
		}

		json_decode( $contents );
		if ( JSON_ERROR_NONE !== json_last_error() ) {
			/* translators: %s: JSON parser error message. */
			return new WP_Error( 'jme_invalid', sprintf( __( 'Invalid JSON: %s', 'json-media-editor' ), json_last_error_msg() ) );
		}

		return true;
	}

	/**
	 * Stored backups, newest first.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return array[] Each item: time, user, contents.
	 */
	public static function get_backups( $attachment_id ) {
		$backups = get_post_meta( $attachment_id, self::BACKUP_META, true );

		return is_array( $backups ) ? $backups : array();
	}

	/**
	 * Restore a backup by its index in get_backups().
	 *
	 * @param int $attachment_id Attachment ID.
	 * @param int $index         Backup index.
	 * @return true|WP_Error
	 */
	public static function restore( $attachment_id, $index ) {
		$backups = self::get_backups( $attachment_id );

		if ( ! isset( $backups[ $index ]['contents'] ) ) {
			return new WP_Error( 'jme_no_backup', __( 'That backup no longer exists.', 'json-media-editor' ) );
		}

		return self::save( $attachment_id, $backups[ $index ]['contents'] );
	}

	/**
	 * Cache-busting versions keyed by attachment ID.
	 *
	 * @return int[]
	 */
	public static function get_versions() {
		$versions = get_option( self::VERSION_OPTION, array() );

		return is_array( $versions ) ? $versions : array();
	}

	/**
	 * Prepend a backup and trim the list to MAX_BACKUPS.
	 *
	 * @param int    $attachment_id Attachment ID.
	 * @param string $contents      Previous file contents.
	 */
	private static function add_backup( $attachment_id, $contents ) {
		$backups = self::get_backups( $attachment_id );

		array_unshift(
			$backups,
			array(
				'time'     => time(),
				'user'     => get_current_user_id(),
				'contents' => $contents,
			)
		);

		// wp_slash() because update_post_meta() unslashes, which would strip the JSON's backslashes.
		update_post_meta( $attachment_id, self::BACKUP_META, wp_slash( array_slice( $backups, 0, self::MAX_BACKUPS ) ) );
	}

	/**
	 * Record a new version so front-end URLs to this file bypass browser caches.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	private static function bump_version( $attachment_id ) {
		$versions = self::get_versions();

		$versions[ (int) $attachment_id ] = time();
		update_option( self::VERSION_OPTION, $versions, true );
	}

	/**
	 * Initialise and return the WP_Filesystem instance.
	 *
	 * @return WP_Filesystem_Base|WP_Error
	 */
	private static function filesystem() {
		global $wp_filesystem;

		if ( ! function_exists( 'WP_Filesystem' ) ) {
			require_once ABSPATH . 'wp-admin/includes/file.php';
		}

		if ( ! $wp_filesystem && ! WP_Filesystem() ) {
			return new WP_Error( 'jme_filesystem', __( 'Could not access the filesystem.', 'json-media-editor' ) );
		}

		return $wp_filesystem;
	}
}
