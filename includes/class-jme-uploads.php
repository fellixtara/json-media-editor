<?php
/**
 * Allow font uploads so fonts referenced by JSON files can be replaced from the Media Library.
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Adds .ttf, .otf, .woff and .woff2 to the allowed upload types.
 */
class JME_Uploads {

	/** Extension => MIME type registered for uploads. */
	const FONT_TYPES = array(
		'ttf'   => 'font/ttf',
		'otf'   => 'font/otf',
		'woff'  => 'font/woff',
		'woff2' => 'font/woff2',
	);

	/** MIME types PHP's fileinfo may report for real font files. */
	const DETECTED_FONT_MIMES = array(
		'font/ttf',
		'font/otf',
		'font/sfnt',
		'font/woff',
		'font/woff2',
		'application/font-sfnt',
		'application/font-woff',
		'application/x-font-ttf',
		'application/x-font-otf',
		'application/x-font-truetype',
		'application/x-font-opentype',
		'application/vnd.ms-opentype',
		'application/octet-stream',
	);

	/**
	 * Register hooks.
	 */
	public static function init() {
		/**
		 * Whether the plugin allows font uploads to the Media Library.
		 *
		 * @param bool $allow Default true.
		 */
		if ( ! apply_filters( 'jme_allow_font_uploads', true ) ) {
			return;
		}

		add_filter( 'upload_mimes', array( __CLASS__, 'upload_mimes' ) );
		add_filter( 'wp_check_filetype_and_ext', array( __CLASS__, 'check_filetype' ), 10, 4 );
		// Late, so other plugins that allow fonts by extension alone cannot re-accept a fake font.
		add_filter( 'wp_check_filetype_and_ext', array( __CLASS__, 'reject_fake_fonts' ), 999, 3 );
	}

	/**
	 * Add font types for users who can upload files.
	 *
	 * @param array $mimes Allowed MIME types keyed by extension pattern.
	 * @return array
	 */
	public static function upload_mimes( $mimes ) {
		if ( current_user_can( 'upload_files' ) ) {
			$mimes = array_merge( $mimes, self::FONT_TYPES );
		}

		return $mimes;
	}

	/**
	 * WordPress compares the extension with the MIME type detected from the file
	 * contents, which differs per server for fonts. Accept a font when its contents
	 * are reported as one of the known font types.
	 *
	 * @param array    $data     Values for ext, type and proper_filename.
	 * @param string   $file     Full path to the file.
	 * @param string   $filename File name.
	 * @param string[] $mimes    Allowed MIME types.
	 * @return array
	 */
	public static function check_filetype( $data, $file, $filename, $mimes ) {
		$ext = strtolower( pathinfo( (string) $filename, PATHINFO_EXTENSION ) );
		if ( ! isset( self::FONT_TYPES[ $ext ] ) || ( ! empty( $data['ext'] ) && ! empty( $data['type'] ) ) || ! current_user_can( 'upload_files' ) ) {
			return $data;
		}

		if ( is_array( $mimes ) && ! in_array( self::FONT_TYPES[ $ext ], $mimes, true ) ) {
			return $data;
		}

		$real = function_exists( 'finfo_open' ) && is_readable( $file ) ? self::detect( $file ) : '';
		if ( '' === $real || in_array( $real, self::DETECTED_FONT_MIMES, true ) ) {
			$data['ext']  = $ext;
			$data['type'] = self::FONT_TYPES[ $ext ];
		}

		return $data;
	}

	/**
	 * Reject any .ttf/.otf/.woff/.woff2 upload whose first bytes are not a font signature.
	 *
	 * @param array  $data     Values for ext, type and proper_filename.
	 * @param string $file     Full path to the file.
	 * @param string $filename File name.
	 * @return array
	 */
	public static function reject_fake_fonts( $data, $file, $filename ) {
		$ext = strtolower( pathinfo( (string) $filename, PATHINFO_EXTENSION ) );

		if ( isset( self::FONT_TYPES[ $ext ] ) && ! empty( $data['ext'] ) && ! self::has_font_signature( $file ) ) {
			$data['ext']  = false;
			$data['type'] = false;
		}

		return $data;
	}

	/**
	 * Whether the file starts with a TrueType, OpenType, collection, WOFF or WOFF2 signature.
	 *
	 * @param string $file Path.
	 * @return bool
	 */
	private static function has_font_signature( $file ) {
		if ( ! is_readable( $file ) ) {
			return false;
		}

		$handle = fopen( $file, 'rb' ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fopen
		$magic  = $handle ? fread( $handle, 4 ) : ''; // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fread
		if ( $handle ) {
			fclose( $handle ); // phpcs:ignore WordPress.WP.AlternativeFunctions.file_system_operations_fclose
		}

		return in_array( $magic, array( "\x00\x01\x00\x00", 'true', 'typ1', 'OTTO', 'ttcf', 'wOFF', 'wOF2' ), true );
	}

	/**
	 * MIME type detected from file contents.
	 *
	 * @param string $file Path.
	 * @return string
	 */
	private static function detect( $file ) {
		$finfo = finfo_open( FILEINFO_MIME_TYPE );
		$type  = $finfo ? finfo_file( $finfo, $file ) : '';
		if ( $finfo ) {
			finfo_close( $finfo );
		}

		return is_string( $type ) ? $type : '';
	}
}
