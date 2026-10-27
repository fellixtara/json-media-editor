<?php
/**
 * Admin screens: file picker, editor, save and restore handlers.
 *
 * @package JSON_Media_Editor
 */

if ( ! defined( 'ABSPATH' ) ) {
	exit;
}

/**
 * Media > JSON Editor admin page.
 */
class JME_Admin {

	const PAGE_SLUG = 'json-media-editor';

	/** Hook suffix returned by add_media_page(). */
	private static $hook = '';

	/**
	 * Register hooks.
	 */
	public static function init() {
		add_action( 'admin_menu', array( __CLASS__, 'register_page' ) );
		add_action( 'admin_enqueue_scripts', array( __CLASS__, 'enqueue' ) );
		add_action( 'admin_post_jme_save', array( __CLASS__, 'handle_save' ) );
		add_action( 'admin_post_jme_restore', array( __CLASS__, 'handle_restore' ) );
		add_filter( 'media_row_actions', array( __CLASS__, 'row_action' ), 10, 2 );
		add_filter( 'plugin_action_links_' . plugin_basename( JME_FILE ), array( __CLASS__, 'plugin_link' ) );
	}

	/**
	 * Whether the current user may edit the given JSON attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 * @return bool
	 */
	public static function can_edit( $attachment_id ) {
		return current_user_can( 'upload_files' ) && current_user_can( 'edit_post', $attachment_id );
	}

	/**
	 * Admin URL of the list screen, or of the editor for one file.
	 *
	 * @param int   $attachment_id Optional attachment ID.
	 * @param array $args          Extra query args.
	 * @return string
	 */
	public static function page_url( $attachment_id = 0, $args = array() ) {
		$args = array_merge( array( 'page' => self::PAGE_SLUG ), $attachment_id ? array( 'attachment_id' => (int) $attachment_id ) : array(), $args );

		return add_query_arg( $args, admin_url( 'upload.php' ) );
	}

	/**
	 * Add Media > JSON Editor.
	 */
	public static function register_page() {
		self::$hook = add_media_page(
			__( 'JSON Editor', 'json-media-editor' ),
			__( 'JSON Editor', 'json-media-editor' ),
			'upload_files',
			self::PAGE_SLUG,
			array( __CLASS__, 'render_page' )
		);
	}

	/**
	 * Load the code editor and our assets on the editor screen only.
	 *
	 * @param string $hook_suffix Current admin page.
	 */
	public static function enqueue( $hook_suffix ) {
		if ( $hook_suffix !== self::$hook ) {
			return;
		}

		wp_enqueue_style( 'jme-admin', JME_URL . 'assets/admin.css', array(), JME_VERSION );

		if ( empty( $_GET['attachment_id'] ) ) { // phpcs:ignore WordPress.Security.NonceVerification.Recommended
			return;
		}

		wp_enqueue_media();

		$settings = wp_enqueue_code_editor(
			array(
				'type'       => 'application/json',
				'codemirror' => array(
					'lineWrapping' => true,
					'foldGutter'   => true,
					'gutters'      => array( 'CodeMirror-lint-markers', 'CodeMirror-linenumbers', 'CodeMirror-foldgutter' ),
				),
			)
		);

		wp_enqueue_script( 'jme-admin', JME_URL . 'assets/admin.js', array( 'jquery' ), JME_VERSION, true );
		wp_localize_script(
			'jme-admin',
			'jmeAdmin',
			array(
				'codeEditor' => $settings,
				'fileUrl'    => wp_get_attachment_url( absint( $_GET['attachment_id'] ) ), // phpcs:ignore WordPress.Security.NonceVerification.Recommended
				'i18n'       => array(
					'invalid'      => __( 'The JSON is not valid, so it was not saved:', 'json-media-editor' ),
					'invalidLoad'  => __( 'The stored file is not valid JSON. It is shown unchanged; fix it before saving.', 'json-media-editor' ),
					'chooseImage'  => __( 'Choose image', 'json-media-editor' ),
					'chooseFile'   => __( 'Choose file', 'json-media-editor' ),
					'useFile'      => __( 'Use this file', 'json-media-editor' ),
					'noFields'     => __( 'No images, fonts, files or texts were detected in this file. You can still edit the JSON below.', 'json-media-editor' ),
					'image'        => __( 'Image', 'json-media-editor' ),
					'fontFile'     => __( 'Font file', 'json-media-editor' ),
					'file'         => __( 'File', 'json-media-editor' ),
					'text'         => __( 'Text', 'json-media-editor' ),
					'baseStyle'    => __( 'Text style', 'json-media-editor' ),
					'fontHint'     => __( 'Upload a .ttf, .otf, .woff or .woff2 file. If the new font has a different name, also update "Font family" — copies in the same layer are kept in sync.', 'json-media-editor' ),
					'unsaved'      => __( 'Changed — click "Save JSON" to apply.', 'json-media-editor' ),
					'layer'        => __( 'Layer', 'json-media-editor' ),
					'confirmLeave' => __( 'You have unsaved changes.', 'json-media-editor' ),
				),
			)
		);
	}

	/**
	 * "Edit JSON" link in the Media Library list view.
	 *
	 * @param string[] $actions Row actions.
	 * @param WP_Post  $post    Attachment.
	 * @return string[]
	 */
	public static function row_action( $actions, $post ) {
		if ( JME_Files::is_json_attachment( $post->ID ) && self::can_edit( $post->ID ) ) {
			$actions['jme_edit'] = sprintf( '<a href="%s">%s</a>', esc_url( self::page_url( $post->ID ) ), esc_html__( 'Edit JSON', 'json-media-editor' ) );
		}

		return $actions;
	}

	/**
	 * "Open editor" link on the Plugins screen.
	 *
	 * @param string[] $links Plugin action links.
	 * @return string[]
	 */
	public static function plugin_link( $links ) {
		array_unshift( $links, sprintf( '<a href="%s">%s</a>', esc_url( self::page_url() ), esc_html__( 'Open editor', 'json-media-editor' ) ) );

		return $links;
	}

	/**
	 * Render the list or the editor.
	 */
	public static function render_page() {
		if ( ! current_user_can( 'upload_files' ) ) {
			wp_die( esc_html__( 'You do not have permission to access this page.', 'json-media-editor' ) );
		}

		$attachment_id = isset( $_GET['attachment_id'] ) ? absint( $_GET['attachment_id'] ) : 0; // phpcs:ignore WordPress.Security.NonceVerification.Recommended

		echo '<div class="wrap jme-wrap">';
		self::render_notice();

		if ( $attachment_id ) {
			self::render_editor( $attachment_id );
		} else {
			self::render_list();
		}

		echo '</div>';
	}

	/**
	 * Success / error message passed back through the redirect.
	 */
	private static function render_notice() {
		// phpcs:disable WordPress.Security.NonceVerification.Recommended -- display only.
		if ( isset( $_GET['jme_saved'] ) ) {
			$message = 'restored' === $_GET['jme_saved']
				? __( 'Backup restored. The animation now uses the restored file.', 'json-media-editor' )
				: __( 'JSON saved. The animation now uses the updated file.', 'json-media-editor' );
			printf( '<div class="notice notice-success is-dismissible"><p>%s</p></div>', esc_html( $message ) );
		}

		if ( isset( $_GET['jme_error'] ) ) {
			$error = get_transient( 'jme_error_' . get_current_user_id() );
			delete_transient( 'jme_error_' . get_current_user_id() );
			printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( $error ? $error : __( 'The file could not be saved.', 'json-media-editor' ) ) );
		}
		// phpcs:enable
	}

	/**
	 * Step 1: pick one of the uploaded JSON files.
	 */
	private static function render_list() {
		$files = JME_Files::get_json_attachments();
		?>
		<h1><?php esc_html_e( 'JSON Editor', 'json-media-editor' ); ?></h1>
		<p class="description"><?php esc_html_e( 'Choose a JSON file from the Media Library to edit it. Saving overwrites the file at the same URL, so any animation that loads it updates automatically.', 'json-media-editor' ); ?></p>

		<?php if ( ! $files ) : ?>
			<div class="jme-empty">
				<p><?php esc_html_e( 'No JSON files were found in the Media Library.', 'json-media-editor' ); ?></p>
			</div>
			<?php
			return;
		endif;
		?>

		<table class="wp-list-table widefat fixed striped jme-files">
			<thead>
				<tr>
					<th scope="col" class="column-primary"><?php esc_html_e( 'File', 'json-media-editor' ); ?></th>
					<th scope="col"><?php esc_html_e( 'URL', 'json-media-editor' ); ?></th>
					<th scope="col" class="jme-col-small"><?php esc_html_e( 'Size', 'json-media-editor' ); ?></th>
					<th scope="col" class="jme-col-small"><?php esc_html_e( 'Modified', 'json-media-editor' ); ?></th>
					<th scope="col" class="jme-col-action"><span class="screen-reader-text"><?php esc_html_e( 'Action', 'json-media-editor' ); ?></span></th>
				</tr>
			</thead>
			<tbody>
			<?php foreach ( $files as $file ) : ?>
				<?php
				$path = JME_Files::get_path( $file->ID );
				$ok   = ! is_wp_error( $path );
				?>
				<tr>
					<td class="column-primary">
						<strong><?php echo esc_html( basename( (string) get_post_meta( $file->ID, '_wp_attached_file', true ) ) ); ?></strong>
						<?php if ( get_the_title( $file ) ) : ?>
							<br><span class="description"><?php echo esc_html( get_the_title( $file ) ); ?></span>
						<?php endif; ?>
					</td>
					<td><code class="jme-url"><?php echo esc_html( wp_get_attachment_url( $file->ID ) ); ?></code></td>
					<td><?php echo $ok ? esc_html( size_format( filesize( $path ) ) ) : '&mdash;'; ?></td>
					<td><?php echo $ok ? esc_html( wp_date( get_option( 'date_format' ) . ' H:i', filemtime( $path ) ) ) : '&mdash;'; ?></td>
					<td class="jme-col-action">
						<?php if ( ! $ok ) : ?>
							<span class="description"><?php esc_html_e( 'File missing', 'json-media-editor' ); ?></span>
						<?php elseif ( self::can_edit( $file->ID ) ) : ?>
							<a class="button button-primary" href="<?php echo esc_url( self::page_url( $file->ID ) ); ?>"><?php esc_html_e( 'Select', 'json-media-editor' ); ?></a>
						<?php endif; ?>
					</td>
				</tr>
			<?php endforeach; ?>
			</tbody>
		</table>
		<?php
	}

	/**
	 * Step 2: image fields + code editor + save.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	private static function render_editor( $attachment_id ) {
		if ( ! self::can_edit( $attachment_id ) ) {
			wp_die( esc_html__( 'You are not allowed to edit this file.', 'json-media-editor' ) );
		}

		$contents = JME_Files::read( $attachment_id );
		$name     = basename( (string) get_post_meta( $attachment_id, '_wp_attached_file', true ) );
		$url      = wp_get_attachment_url( $attachment_id );
		?>
		<h1 class="wp-heading-inline">
			<?php
			/* translators: %s: file name. */
			printf( esc_html__( 'Edit %s', 'json-media-editor' ), esc_html( $name ) );
			?>
		</h1>
		<a class="page-title-action" href="<?php echo esc_url( self::page_url() ); ?>">&larr; <?php esc_html_e( 'All JSON files', 'json-media-editor' ); ?></a>
		<hr class="wp-header-end">
		<p><code class="jme-url"><?php echo esc_html( $url ); ?></code> <a href="<?php echo esc_url( $url ); ?>" target="_blank" rel="noopener"><?php esc_html_e( 'View file', 'json-media-editor' ); ?></a></p>

		<?php
		if ( is_wp_error( $contents ) ) {
			printf( '<div class="notice notice-error"><p>%s</p></div>', esc_html( $contents->get_error_message() ) );
			return;
		}
		?>

		<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>" id="jme-form">
			<input type="hidden" name="action" value="jme_save">
			<input type="hidden" name="attachment_id" value="<?php echo esc_attr( $attachment_id ); ?>">
			<?php wp_nonce_field( 'jme_save_' . $attachment_id ); ?>

			<div class="jme-panel">
				<h2><?php esc_html_e( 'Customizable content', 'json-media-editor' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Images, fonts, media files, texts and text styles detected in the file, grouped by layer. Change them here — the JSON below updates automatically.', 'json-media-editor' ); ?></p>
				<div id="jme-fields" class="jme-fields"></div>
			</div>

			<div class="jme-panel">
				<h2><?php esc_html_e( 'JSON', 'json-media-editor' ); ?></h2>
				<p class="description"><?php esc_html_e( 'Shown neatly indented for readability. Only whitespace is changed for display; data and values stay exactly the same.', 'json-media-editor' ); ?></p>
				<div id="jme-error" class="notice notice-error inline" hidden><p></p></div>
				<textarea id="jme-content" name="jme_content" rows="30" class="large-text code" spellcheck="false"><?php echo esc_textarea( $contents ); ?></textarea>
			</div>

			<div class="jme-actions">
				<label>
					<input type="checkbox" name="jme_minify" id="jme-minify" value="1" <?php checked( ! self::is_pretty( $contents ) ); ?>>
					<?php esc_html_e( 'Save compact (smaller file, same format as the original)', 'json-media-editor' ); ?>
				</label>
				<span id="jme-status" class="jme-status" aria-live="polite"></span>
				<?php submit_button( __( 'Save JSON', 'json-media-editor' ), 'primary large', 'submit', false ); ?>
			</div>
		</form>

		<?php
		self::render_backups( $attachment_id );
	}

	/**
	 * Previous versions with restore buttons.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	private static function render_backups( $attachment_id ) {
		$backups = JME_Files::get_backups( $attachment_id );
		if ( ! $backups ) {
			return;
		}
		?>
		<div class="jme-panel">
			<h2><?php esc_html_e( 'Backups', 'json-media-editor' ); ?></h2>
			<p class="description">
				<?php
				/* translators: %d: number of backups kept. */
				printf( esc_html__( 'The last %d versions are kept automatically before each save.', 'json-media-editor' ), (int) JME_Files::MAX_BACKUPS );
				?>
			</p>
			<table class="widefat striped jme-backups">
				<tbody>
				<?php foreach ( $backups as $index => $backup ) : ?>
					<?php $user = get_userdata( (int) $backup['user'] ); ?>
					<tr>
						<td><?php echo esc_html( wp_date( get_option( 'date_format' ) . ' H:i:s', (int) $backup['time'] ) ); ?></td>
						<td><?php echo esc_html( $user ? $user->display_name : '—' ); ?></td>
						<td><?php echo esc_html( size_format( strlen( $backup['contents'] ) ) ); ?></td>
						<td class="jme-col-action">
							<form method="post" action="<?php echo esc_url( admin_url( 'admin-post.php' ) ); ?>">
								<input type="hidden" name="action" value="jme_restore">
								<input type="hidden" name="attachment_id" value="<?php echo esc_attr( $attachment_id ); ?>">
								<input type="hidden" name="backup" value="<?php echo esc_attr( $index ); ?>">
								<?php wp_nonce_field( 'jme_restore_' . $attachment_id ); ?>
								<button type="submit" class="button"><?php esc_html_e( 'Restore', 'json-media-editor' ); ?></button>
							</form>
						</td>
					</tr>
				<?php endforeach; ?>
				</tbody>
			</table>
		</div>
		<?php
	}

	/**
	 * Save handler (admin-post.php?action=jme_save).
	 */
	public static function handle_save() {
		$attachment_id = isset( $_POST['attachment_id'] ) ? absint( $_POST['attachment_id'] ) : 0;

		check_admin_referer( 'jme_save_' . $attachment_id );
		self::require_edit( $attachment_id );

		// Raw JSON on purpose: sanitizing would alter the data. It is validated by JME_Files::save().
		$contents = isset( $_POST['jme_content'] ) ? wp_unslash( $_POST['jme_content'] ) : ''; // phpcs:ignore WordPress.Security.ValidatedSanitizedInput.InputNotSanitized

		self::redirect_result( $attachment_id, JME_Files::save( $attachment_id, $contents ), 'saved' );
	}

	/**
	 * Restore handler (admin-post.php?action=jme_restore).
	 */
	public static function handle_restore() {
		$attachment_id = isset( $_POST['attachment_id'] ) ? absint( $_POST['attachment_id'] ) : 0;

		check_admin_referer( 'jme_restore_' . $attachment_id );
		self::require_edit( $attachment_id );

		$index = isset( $_POST['backup'] ) ? absint( $_POST['backup'] ) : -1;

		self::redirect_result( $attachment_id, JME_Files::restore( $attachment_id, $index ), 'restored' );
	}

	/**
	 * Stop unless the current user can edit the attachment.
	 *
	 * @param int $attachment_id Attachment ID.
	 */
	private static function require_edit( $attachment_id ) {
		if ( ! $attachment_id || ! self::can_edit( $attachment_id ) ) {
			wp_die( esc_html__( 'You are not allowed to edit this file.', 'json-media-editor' ), 403 );
		}
	}

	/**
	 * Redirect back to the editor with a success flag or error message.
	 *
	 * @param int           $attachment_id Attachment ID.
	 * @param true|WP_Error $result        Save result.
	 * @param string        $flag          Success flag value.
	 */
	private static function redirect_result( $attachment_id, $result, $flag ) {
		if ( is_wp_error( $result ) ) {
			set_transient( 'jme_error_' . get_current_user_id(), $result->get_error_message(), MINUTE_IN_SECONDS );
			$args = array( 'jme_error' => 1 );
		} else {
			$args = array( 'jme_saved' => $flag );
		}

		wp_safe_redirect( self::page_url( $attachment_id, $args ) );
		exit;
	}

	/**
	 * Whether the stored JSON is already multi-line (pretty-printed).
	 *
	 * @param string $contents JSON text.
	 * @return bool
	 */
	private static function is_pretty( $contents ) {
		return (bool) preg_match( '/^[\[{]\s*\n/', ltrim( $contents ) );
	}
}
