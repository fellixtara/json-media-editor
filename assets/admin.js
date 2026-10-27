/**
 * JSON Media Editor — editor screen.
 *
 * Pretty-prints the JSON for display, lists image URLs with Media Library
 * pickers, validates before submit and optionally saves compact JSON.
 */
( function ( $ ) {
	'use strict';

	var IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp)(?:[?#].*)?$/i;
	var IMAGE_KEYS = /^(src|image|img|url|texture|background|bg|poster)$/i;

	var config = window.jmeAdmin || {};
	var i18n = config.i18n || {};
	var $textarea = $( '#jme-content' );
	var $images = $( '#jme-images' );
	var $error = $( '#jme-error' );
	var $status = $( '#jme-status' );
	var editor = null;
	var dirty = false;
	var rescanTimer = null;

	if ( ! $textarea.length ) {
		return;
	}

	function getText() {
		return editor ? editor.getValue() : $textarea.val();
	}

	function setText( text ) {
		if ( editor ) {
			editor.setValue( text );
		} else {
			$textarea.val( text );
		}
	}

	function pretty( data ) {
		return JSON.stringify( data, null, 2 );
	}

	function parse( text ) {
		try {
			return { ok: true, data: JSON.parse( text ) };
		} catch ( e ) {
			return { ok: false, message: e.message };
		}
	}

	function showError( message ) {
		$error.prop( 'hidden', ! message ).find( 'p' ).text( message || '' );
	}

	function markDirty() {
		dirty = true;
		$status.text( i18n.unsaved || '' );
	}

	function isImageValue( key, value ) {
		if ( 'string' !== typeof value || ! value ) {
			return false;
		}
		if ( 0 === value.indexOf( 'data:image/' ) ) {
			return true;
		}
		if ( ! /^(https?:)?\/\//i.test( value ) && 0 !== value.indexOf( '/' ) ) {
			return false;
		}
		return IMAGE_EXT.test( value ) || IMAGE_KEYS.test( String( key ) );
	}

	/** Collect { path, value, parent } for every image-like string value. */
	function findImages( data ) {
		var found = [];

		( function walk( node, path, parent ) {
			if ( Array.isArray( node ) ) {
				node.forEach( function ( child, i ) {
					walk( child, path.concat( i ), node );
				} );
			} else if ( node && 'object' === typeof node ) {
				Object.keys( node ).forEach( function ( key ) {
					var child = node[ key ];
					if ( isImageValue( key, child ) ) {
						found.push( { path: path.concat( key ), value: child, parent: node } );
					} else {
						walk( child, path.concat( key ), node );
					}
				} );
			}
		} )( data, [], null );

		return found;
	}

	function pathLabel( path ) {
		return path.reduce( function ( out, part ) {
			return 'number' === typeof part ? out + '[' + part + ']' : ( out ? out + '.' : '' ) + part;
		}, '' );
	}

	function itemTitle( item, index ) {
		var p = item.parent || {};
		var name = p.layerName || p.name || p.title || p.nm || p.id;
		var title = ( i18n.layer || 'Layer' ) + ' ' + ( index + 1 );
		if ( name && 'string' === typeof name ) {
			title += ' — ' + name;
		} else if ( p.layerType ) {
			title += ' — ' + p.layerType;
		}
		return title;
	}

	function getAt( data, path ) {
		return path.reduce( function ( node, key ) {
			return node == null ? undefined : node[ key ];
		}, data );
	}

	/** Write a new image into the JSON at `path`, keeping natural sizes in sync. */
	function applyImage( path, url, width, height ) {
		var result = parse( getText() );
		if ( ! result.ok ) {
			showError( ( i18n.invalid || '' ) + ' ' + result.message );
			return false;
		}

		var parent = getAt( result.data, path.slice( 0, -1 ) );
		if ( ! parent || 'object' !== typeof parent ) {
			return false;
		}

		parent[ path[ path.length - 1 ] ] = url;

		// Unicorn Studio image layers store the source image size; keep it accurate for the new image.
		if ( width && height && 'naturalWidth' in parent && 'naturalHeight' in parent ) {
			parent.naturalWidth = width;
			parent.naturalHeight = height;
		}

		setText( pretty( result.data ) );
		showError( '' );
		markDirty();
		return true;
	}

	function renderImages() {
		var result = parse( getText() );
		if ( ! result.ok ) {
			return;
		}

		var items = findImages( result.data );
		$images.empty();

		if ( ! items.length ) {
			$images.append( $( '<p class="jme-muted">' ).text( i18n.noImages || '' ) );
			return;
		}

		items.forEach( function ( item, index ) {
			var $card = $( '<div class="jme-image">' );
			var $preview = $( '<div class="jme-image-preview">' ).append( $( '<img alt="">' ).attr( 'src', item.value ) );
			var $body = $( '<div class="jme-image-body">' );
			var $input = $( '<input type="url" class="large-text code">' ).val( item.value );
			var $button = $( '<button type="button" class="button">' ).text( i18n.chooseImage || 'Choose image' );

			$body.append(
				$( '<strong>' ).text( itemTitle( item, index ) ),
				$( '<code class="jme-path">' ).text( pathLabel( item.path ) ),
				$input,
				$( '<p>' ).append( $button )
			);
			$card.append( $preview, $body ).appendTo( $images );

			$input.on( 'change', function () {
				var url = $.trim( $input.val() );
				if ( url && applyImage( item.path, url ) ) {
					$preview.find( 'img' ).attr( 'src', url );
				}
			} );

			$button.on( 'click', function () {
				var frame = wp.media( {
					title: i18n.chooseImage,
					button: { text: i18n.useImage },
					library: { type: 'image' },
					multiple: false,
				} );

				frame.on( 'select', function () {
					var media = frame.state().get( 'selection' ).first().toJSON();
					if ( applyImage( item.path, media.url, media.width, media.height ) ) {
						$input.val( media.url );
						$preview.find( 'img' ).attr( 'src', media.url );
					}
				} );

				frame.open();
			} );
		} );
	}

	// Display the JSON indented; JSON.parse/stringify changes whitespace only.
	var initial = parse( $textarea.val() );
	if ( initial.ok ) {
		$textarea.val( pretty( initial.data ) );
	} else {
		showError( i18n.invalidLoad );
	}

	if ( window.wp && wp.codeEditor && config.codeEditor ) {
		editor = wp.codeEditor.initialize( $textarea, config.codeEditor ).codemirror;
		editor.on( 'change', function ( cm, change ) {
			if ( 'setValue' !== change.origin ) {
				markDirty();
				clearTimeout( rescanTimer );
				rescanTimer = setTimeout( renderImages, 600 );
			}
		} );
	} else {
		$textarea.on( 'input', markDirty );
	}

	renderImages();

	$( '#jme-form' ).on( 'submit', function ( event ) {
		var result = parse( getText() );

		if ( ! result.ok ) {
			event.preventDefault();
			showError( ( i18n.invalid || '' ) + ' ' + result.message );
			$( 'html, body' ).animate( { scrollTop: $error.offset().top - 60 }, 200 );
			return;
		}

		$textarea.val( $( '#jme-minify' ).is( ':checked' ) ? JSON.stringify( result.data ) : getText() );
		dirty = false;
	} );

	$( window ).on( 'beforeunload', function () {
		return dirty ? i18n.confirmLeave : undefined;
	} );
} )( jQuery );
