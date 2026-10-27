<?php
/**
 * Front-end cache busting for edited JSON files.
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Appends ?ver=<saved time> to URLs of edited JSON files in page output, so
 * visitors' browsers fetch the new animation file instead of a cached copy.
 */
class JME_Frontend {

	/**
	 * Register hooks.
	 */
	public static function init() {
		if ( is_admin() ) {
			return;
		}

		add_filter( 'the_content', array( __CLASS__, 'version_urls' ), 999 );
		add_filter( 'elementor/frontend/the_content', array( __CLASS__, 'version_urls' ), 999 );
		add_filter( 'widget_text', array( __CLASS__, 'version_urls' ), 999 );
		add_filter( 'widget_block_content', array( __CLASS__, 'version_urls' ), 999 );
	}

	/**
	 * Add the version query to every edited JSON URL found in the HTML.
	 *
	 * @param string $html Rendered content.
	 * @return string
	 */
	public static function version_urls( $html ) {
		if ( ! is_string( $html ) || false === stripos( $html, '.json' ) ) {
			return $html;
		}

		foreach ( JME_Files::get_versions() as $attachment_id => $version ) {
			$url = wp_get_attachment_url( $attachment_id );
			if ( ! $url ) {
				continue;
			}

			// Match http, https and protocol-relative forms; skip URLs that already carry a query string.
			$pattern = '#((?:https?:)?' . preg_quote( preg_replace( '#^https?:#i', '', $url ), '#' ) . ')(?![?\w.-])#i';
			$html    = preg_replace( $pattern, '$1?ver=' . (int) $version, $html );
		}

		return $html;
	}
}
