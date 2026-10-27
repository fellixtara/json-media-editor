/**
 * JSON Media Editor — editor screen.
 *
 * Pretty-prints the JSON for display, detects customizable values (images,
 * fonts, other media files, texts and their typography), validates before
 * submit and optionally saves compact JSON.
 */
( function ( $ ) {
	'use strict';

	var IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|svg|bmp|ico)(?:[?#].*)?$/i;
	var FONT_EXT = /\.(ttf|otf|woff2?|eot)(?:[?#].*)?$/i;
	var FILE_EXT = /\.(mp4|webm|ogv|mov|mp3|wav|ogg|m4a|json|glb|gltf|hdr|pdf)(?:[?#].*)?$/i;
	var IMAGE_KEYS = /^(src|image|img|url|texture|background|bg|poster)$/i;
	var TEXT_KEYS = /^(textContent|text|content|title|subtitle|heading|label|caption|placeholder|buttonText|altText|alt|description)$/i;
	var FAMILY_KEYS = /^(fontFamily|family|fFamily|fName)$/;
	var HEX_COLOR = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;
	var FONT_MIME = [ 'font', 'application/x-font-ttf', 'application/x-font-otf', 'application/font-woff', 'application/font-woff2', 'application/vnd.ms-opentype', 'application/font-sfnt', 'application/x-font-woff' ];

	// Typography shown next to a text or font. [key, label, input type]
	var STYLE_FIELDS = [
		[ 'fontFamily', 'Font family', 'text' ],
		[ 'family', 'Font family', 'text' ],
		[ 'fFamily', 'Font family', 'text' ],
		[ 'fName', 'Font name', 'text' ],
		[ 'fStyle', 'Font style', 'text' ],
		[ 'fontSize', 'Font size', 'number' ],
		[ 'fontWeight', 'Font weight', 'text' ],
		[ 'fontStyle', 'Font style', 'text' ],
		[ 'lineHeight', 'Line height', 'number' ],
		[ 'letterSpacing', 'Letter spacing', 'number' ],
		[ 'textAlign', 'Text align', 'align' ],
		[ 'fill', 'Color', 'color' ],
		[ 'color', 'Color', 'color' ],
		[ 'textColor', 'Text color', 'color' ],
		// Lottie text document keys.
		[ 'f', 'Font', 'text' ],
		[ 's', 'Font size', 'number' ],
		[ 'lh', 'Line height', 'number' ],
		[ 'tr', 'Tracking', 'number' ],
		// Text box size, only for text layers and their breakpoints.
		[ 'width', 'Box width', 'number', 'box' ],
		[ 'height', 'Box height', 'number', 'box' ],
	];

	var config = window.jmeAdmin || {};
	var i18n = config.i18n || {};
	var $textarea = $( '#jme-content' );
	var $fields = $( '#jme-fields' );
	var $error = $( '#jme-error' );
	var $status = $( '#jme-status' );
	var editor = null;
	var dirty = false;
	var rescanTimer = null;
	var fontCount = 0;

	if ( ! $textarea.length ) {
		return;
	}

	function t( key, fallback ) {
		return i18n[ key ] || fallback;
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
		$status.text( t( 'unsaved', '' ) );
	}

	function isUrl( value ) {
		return /^(https?:)?\/\//i.test( value ) || /^\/[^/]/.test( value ) || 0 === value.indexOf( 'data:' );
	}

	function isColor( value ) {
		return HEX_COLOR.test( value ) || ( Array.isArray( value ) && value.length > 0 && value.every( function ( v ) {
			return 'string' === typeof v && HEX_COLOR.test( v );
		} ) );
	}

	/** Kind of a file/URL value: image, font, file — or null. */
	function urlKind( key, value ) {
		if ( 'string' !== typeof value || ! value || ! isUrl( value ) ) {
			return null;
		}
		if ( /^data:(font\/|application\/(x-)?font)/.test( value ) || FONT_EXT.test( value ) ) {
			return 'font';
		}
		if ( 0 === value.indexOf( 'data:image/' ) || IMAGE_EXT.test( value ) ) {
			return 'image';
		}
		if ( FILE_EXT.test( value ) ) {
			return 'file';
		}
		return IMAGE_KEYS.test( String( key ) ) && ! /^data:/.test( value ) ? 'image' : null;
	}

	/** Lottie text documents hold the text in "t" next to font "f" and size "s". */
	function isTextValue( key, value, node ) {
		if ( 'string' !== typeof value || '' === value || isUrl( value ) ) {
			return false;
		}
		if ( 't' === key ) {
			return 'string' === typeof node.f && 'number' === typeof node.s;
		}
		return TEXT_KEYS.test( key );
	}

	function isTextOwner( owner ) {
		return !! owner && ( 'text' === owner.layerType || 'string' === typeof owner.textContent );
	}

	/** Unicorn Studio breakpoint: { name, min, max, props: {...} }. */
	function breakpointName( node ) {
		if ( ! node.props || 'object' !== typeof node.props || 'string' !== typeof node.name || ! ( 'min' in node || 'max' in node ) ) {
			return '';
		}
		var range = null != node.min && null != node.max ? node.min + '–' + node.max + 'px' : ( null != node.min ? '≥' + node.min + 'px' : '≤' + node.max + 'px' );
		return node.name + ' (' + range + ')';
	}

	/** Lottie image asset: { id, w, h, u: folder, p: file name or data URI, e: embedded flag }. */
	function isLottieAsset( node ) {
		return 'string' === typeof node.p && 'string' === typeof node.u && 'number' === typeof node.w && 'number' === typeof node.h &&
			( 0 === node.p.indexOf( 'data:image/' ) || IMAGE_EXT.test( node.p ) );
	}

	/** Absolute URL of a Lottie asset, resolved against the JSON file's URL. */
	function lottieUrl( node ) {
		if ( 0 === node.p.indexOf( 'data:' ) || isUrl( node.p ) ) {
			return node.p;
		}
		try {
			return new URL( ( node.u || '' ) + node.p, config.fileUrl || window.location.href ).href;
		} catch ( e ) {
			return node.p;
		}
	}

	/** Objects that identify a layer / asset, used to group fields. */
	function isOwner( node ) {
		return [ 'layerType', 'layerName', 'nm', 'ty', 'id' ].some( function ( k ) {
			return 'string' === typeof node[ k ];
		} );
	}

	/**
	 * Collect customizable fields grouped by owner (layer).
	 *
	 * @return {Array} groups: { owner, path, fields: [ { path, key, value, kind, label } ] }
	 */
	function findFields( data ) {
		var groups = [];
		var byPath = {};

		function groupFor( owner, ownerPath ) {
			var id = JSON.stringify( ownerPath );
			if ( ! byPath[ id ] ) {
				byPath[ id ] = { owner: owner, path: ownerPath, fields: [] };
				groups.push( byPath[ id ] );
			}
			return byPath[ id ];
		}

		( function walk( node, path, owner, ownerPath, breakpoint ) {
			if ( Array.isArray( node ) ) {
				node.forEach( function ( child, i ) {
					walk( child, path.concat( i ), owner, ownerPath );
				} );
				return;
			}
			if ( ! node || 'object' !== typeof node ) {
				return;
			}

			if ( ! breakpoint && isOwner( node ) ) {
				owner = node;
				ownerPath = path;
			}

			var keys = Object.keys( node );
			var local = [];
			var hasContent = false;

			keys.forEach( function ( key ) {
				var value = node[ key ];
				var kind = 'p' === key && isLottieAsset( node ) ? 'image' : urlKind( key, value );

				if ( kind ) {
					local.push( { key: key, kind: kind } );
					hasContent = hasContent || 'font' === kind;
				} else if ( isTextValue( key, value, node ) ) {
					local.push( { key: key, kind: value.length > 60 || /\n/.test( value ) ? 'textarea' : 'text-content' } );
					hasContent = true;
				}
			} );

			var textBox = ( breakpoint || node === owner ) && isTextOwner( owner );

			// Typography only where there is a text or font (or a font family) in the same object,
			// or in a breakpoint of a text layer.
			if ( hasContent || textBox || keys.some( function ( k ) {
				return FAMILY_KEYS.test( k ) && 'string' === typeof node[ k ];
			} ) ) {
				STYLE_FIELDS.forEach( function ( def ) {
					var key = def[ 0 ];
					var value = node[ key ];
					var lottieOnly = /^(f|s|lh|tr)$/.test( key );

					if ( ! ( key in node ) || ( lottieOnly && ! ( 'string' === typeof node.t ) ) || ( 'box' === def[ 3 ] && ! textBox ) ) {
						return;
					}
					if ( 'color' === def[ 2 ] ? isColor( value ) : ( 'number' === def[ 2 ] ? 'number' === typeof value || ( 'string' === typeof value && '' !== value && ! isNaN( value ) ) : 'string' === typeof value || 'number' === typeof value ) ) {
						local.push( { key: key, kind: def[ 2 ], label: def[ 1 ], breakpoint: breakpoint } );
					}
				} );
			}

			if ( local.length ) {
				var group = groupFor( owner || node, ownerPath || path );
				local.forEach( function ( f ) {
					group.fields.push( {
						path: path.concat( f.key ),
						key: f.key,
						value: node[ f.key ],
						kind: f.kind,
						label: f.label,
						breakpoint: f.breakpoint,
						parentPath: path,
						lottie: 'p' === f.key && isLottieAsset( node ),
						preview: 'p' === f.key && isLottieAsset( node ) ? lottieUrl( node ) : node[ f.key ],
					} );
				} );
			}

			var bp = breakpointName( node );

			keys.forEach( function ( key ) {
				var value = node[ key ];
				if ( value && 'object' === typeof value ) {
					walk( value, path.concat( key ), owner, ownerPath, bp && 'props' === key ? bp : breakpoint );
				}
			} );
		} )( data, [], null, null, '' );

		return groups;
	}

	function pathLabel( path ) {
		return path.reduce( function ( out, part ) {
			return 'number' === typeof part ? out + '[' + part + ']' : ( out ? out + '.' : '' ) + part;
		}, '' );
	}

	function groupTitle( group, index ) {
		var o = group.owner || {};
		var name = o.layerName || o.nm || o.name || o.title || ( ! o.layerType && 'string' === typeof o.id ? o.id : '' );
		var type = o.layerType || o.type || ( 'string' === typeof o.ty ? o.ty : '' );
		var title = t( 'layer', 'Layer' ) + ' ' + ( index + 1 );
		var text = group.fields.filter( function ( f ) {
			return 'text-content' === f.kind || 'textarea' === f.kind;
		} )[ 0 ];

		if ( type ) {
			title += ' — ' + type;
		}
		if ( name && 'string' === typeof name ) {
			title += ': ' + name;
		} else if ( text ) {
			title += ': “' + String( text.value ).slice( 0, 50 ) + '”';
		}
		return title;
	}

	function getAt( data, path ) {
		return path.reduce( function ( node, key ) {
			return node == null ? undefined : node[ key ];
		}, data );
	}

	/** Cast the input string back to the original value's type so behaviour never changes. */
	function castLike( original, raw ) {
		if ( 'number' === typeof original ) {
			var n = parseFloat( raw );
			return isNaN( n ) ? original : n;
		}
		return raw;
	}

	/**
	 * Apply changes to the JSON. `changes` is [ { path, value } ].
	 * Returns the list of extra paths updated by linked syncing.
	 */
	function apply( changes, sync ) {
		var result = parse( getText() );
		if ( ! result.ok ) {
			showError( t( 'invalid', '' ) + ' ' + result.message );
			return null;
		}

		var synced = [];

		changes.forEach( function ( change ) {
			var parent = getAt( result.data, change.path.slice( 0, -1 ) );
			var key = change.path[ change.path.length - 1 ];
			if ( ! parent || 'object' !== typeof parent ) {
				return;
			}

			var old = parent[ key ];
			parent[ key ] = change.value;

			// Keep every copy of a font family name in the same layer identical, so the
			// layer keeps using the loaded font (e.g. Unicorn fontFamily + fontCSS.family).
			if ( sync && FAMILY_KEYS.test( String( key ) ) && 'string' === typeof old ) {
				( function walk( node, path ) {
					if ( ! node || 'object' !== typeof node ) {
						return;
					}
					Object.keys( node ).forEach( function ( k ) {
						var p = path.concat( Array.isArray( node ) ? Number( k ) : k );
						if ( FAMILY_KEYS.test( k ) && node[ k ] === old && JSON.stringify( p ) !== JSON.stringify( change.path ) ) {
							node[ k ] = change.value;
							synced.push( { path: p, value: change.value } );
						} else if ( node[ k ] && 'object' === typeof node[ k ] ) {
							walk( node[ k ], p );
						}
					} );
				} )( getAt( result.data, sync ), sync );
			}
		} );

		setText( pretty( result.data ) );
		showError( '' );
		markDirty();
		return synced;
	}

	function updateInputs( synced ) {
		( synced || [] ).forEach( function ( s ) {
			$fields.find( '[data-path]' ).filter( function () {
				return this.getAttribute( 'data-path' ) === JSON.stringify( s.path );
			} ).val( s.value );
		} );
	}

	function openMedia( type, onSelect ) {
		var frame = wp.media( {
			title: 'image' === type ? t( 'chooseImage', 'Choose image' ) : t( 'chooseFile', 'Choose file' ),
			button: { text: t( 'useFile', 'Use this file' ) },
			library: 'image' === type ? { type: 'image' } : ( 'font' === type ? { type: FONT_MIME } : {} ),
			multiple: false,
		} );

		frame.on( 'select', function () {
			onSelect( frame.state().get( 'selection' ).first().toJSON() );
		} );
		frame.open();
	}

	var WEIGHTS = [ [ 100, 'Thin' ], [ 200, 'ExtraLight' ], [ 300, 'Light' ], [ 400, 'Regular' ], [ 500, 'Medium' ], [ 600, 'SemiBold' ], [ 700, 'Bold' ], [ 800, 'ExtraBold' ], [ 900, 'Black' ] ];
	var fontInfoCache = {};

	function weightName( weight ) {
		var named = WEIGHTS.filter( function ( w ) {
			return w[ 0 ] === weight;
		} )[ 0 ];
		return named ? named[ 1 ] + ' ' + weight : String( weight );
	}

	/** Unicorn Studio text layer (fontStyle / fontWeight are strings there). */
	function isUnicornText( owner ) {
		return !! owner && 'text' === owner.layerType && 'string' === typeof owner.fontStyle;
	}

	/**
	 * How Unicorn Studio draws the text: italic when fontStyle contains "italic",
	 * weight = fontStyle when it is only digits, otherwise 400. fontWeight is only the
	 * weight the font file is registered with (FontFace descriptor).
	 */
	function drawnStyle( owner ) {
		var style = String( owner.fontStyle || '' );
		return { italic: style.indexOf( 'italic' ) > -1, weight: /^\d+$/.test( style ) ? parseInt( style, 10 ) : 400 };
	}

	function registeredWeight( owner ) {
		var weight = parseInt( owner.fontWeight, 10 );
		return isNaN( weight ) ? 400 : weight;
	}

	/** Read weight, italic flag and variable weight axis from a TTF/OTF/WOFF file. Resolves null when unknown. */
	function fontInfo( url ) {
		if ( ! fontInfoCache[ url ] ) {
			fontInfoCache[ url ] = fetch( url ).then( function ( response ) {
				if ( ! response.ok ) {
					throw new Error( response.status );
				}
				return response.arrayBuffer();
			} ).then( parseFont ).catch( function () {
				return null;
			} );
		}
		return fontInfoCache[ url ];
	}

	function tagAt( view, offset ) {
		return String.fromCharCode( view.getUint8( offset ), view.getUint8( offset + 1 ), view.getUint8( offset + 2 ), view.getUint8( offset + 3 ) );
	}

	function parseFont( buffer ) {
		var view = new DataView( buffer );
		var tag = tagAt( view, 0 );
		var tables = {};
		var i;

		if ( 'wOF2' === tag ) {
			return null; // Brotli-compressed tables; not readable without a decoder.
		}

		if ( 'wOFF' === tag ) {
			for ( i = 0; i < view.getUint16( 12 ); i++ ) {
				var rec = 44 + i * 20;
				tables[ tagAt( view, rec ) ] = { offset: view.getUint32( rec + 4 ), length: view.getUint32( rec + 8 ), size: view.getUint32( rec + 12 ) };
			}
		} else {
			var base = 'ttcf' === tag ? view.getUint32( 12 ) : 0;
			for ( i = 0; i < view.getUint16( base + 4 ); i++ ) {
				var entry = base + 12 + i * 16;
				tables[ tagAt( view, entry ) ] = { offset: view.getUint32( entry + 8 ), length: view.getUint32( entry + 12 ) };
			}
		}

		function table( name ) {
			var info = tables[ name ];
			if ( ! info ) {
				return Promise.resolve( null );
			}
			var bytes = new Uint8Array( buffer, info.offset, info.length );
			if ( ! info.size || info.size === info.length ) {
				return Promise.resolve( new DataView( bytes.slice().buffer ) );
			}
			// WOFF 1 tables are zlib-compressed.
			var stream = new Blob( [ bytes ] ).stream().pipeThrough( new DecompressionStream( 'deflate' ) );
			return new Response( stream ).arrayBuffer().then( function ( b ) {
				return new DataView( b );
			} );
		}

		return Promise.all( [ table( 'OS/2' ), table( 'fvar' ) ] ).then( function ( found ) {
			var os2 = found[ 0 ];
			var fvar = found[ 1 ];
			var axis = null;

			if ( ! os2 ) {
				return null;
			}

			if ( fvar ) {
				var axesOffset = fvar.getUint16( 4 );
				var axisSize = fvar.getUint16( 10 );
				for ( var a = 0; a < fvar.getUint16( 8 ); a++ ) {
					var at = axesOffset + a * axisSize;
					if ( 'wght' === tagAt( fvar, at ) ) {
						axis = { min: fvar.getInt32( at + 4 ) / 65536, max: fvar.getInt32( at + 12 ) / 65536 };
					}
				}
			}

			return { weight: os2.getUint16( 4 ), italic: !! ( os2.getUint16( 62 ) & 1 ), axis: axis };
		} );
	}

	function describeFont( info ) {
		if ( ! info ) {
			return t( 'fontUnknown', 'Font details unavailable' );
		}
		var text = weightName( info.weight ) + ( info.italic ? ' Italic' : '' );
		return info.axis ?
			text + ' · ' + t( 'variableFont', 'variable' ) + ' ' + info.axis.min + '–' + info.axis.max :
			text + ' · ' + t( 'singleWeight', 'single weight' );
	}

	/** Preview with the same FontFace descriptors Unicorn Studio uses, so synthetic bold shows too. */
	function previewFont( url, $sample, descriptors ) {
		if ( ! window.FontFace || ! url ) {
			return;
		}
		var family = 'jme-preview-' + ( ++fontCount );
		new FontFace( family, 'url("' + url.replace( /"/g, '%22' ) + '")', descriptors || {} ).load().then( function ( face ) {
			document.fonts.add( face );
			$sample.css( 'font-family', '"' + family + '", sans-serif' ).removeClass( 'is-error' );
		} ).catch( function () {
			$sample.addClass( 'is-error' );
		} );
	}

	function fieldLabel( field ) {
		if ( field.label ) {
			return t( 'label_' + field.key, field.label );
		}
		return {
			image: t( 'image', 'Image' ),
			font: t( 'fontFile', 'Font file' ),
			file: t( 'file', 'File' ),
			'text-content': t( 'text', 'Text' ),
			textarea: t( 'text', 'Text' ),
		}[ field.kind ] || field.key;
	}

	function renderUrlField( field, group, $row ) {
		var $input = $( '<input type="url" class="large-text code">' ).val( field.value ).attr( 'data-path', JSON.stringify( field.path ) );
		var $button = $( '<button type="button" class="button">' ).text( 'image' === field.kind ? t( 'chooseImage', 'Choose image' ) : t( 'chooseFile', 'Choose file' ) );
		var $preview = null;
		var sample = group.fields.filter( function ( f ) {
			return 'text-content' === f.kind || 'textarea' === f.kind;
		} )[ 0 ];

		if ( 'image' === field.kind ) {
			$preview = $( '<div class="jme-image-preview">' ).append( $( '<img alt="">' ).attr( 'src', field.preview ) );
		} else if ( 'font' === field.kind ) {
			$preview = $( '<div class="jme-font-preview">' ).text( sample ? String( sample.value ).slice( 0, 40 ) : 'AaBbCc 0123' );
			group.font = { url: field.value, $preview: $preview, $info: $( '<p class="jme-font-info">' ), info: undefined, field: field };
			loadFontInfo( group, false );
		}

		function refresh( url ) {
			if ( 'image' === field.kind ) {
				$preview.find( 'img' ).attr( 'src', url );
			} else if ( 'font' === field.kind ) {
				group.font.url = url;
				loadFontInfo( group, true );
			}
		}

		/** Changes for a new URL. Lottie assets need an empty folder and a non-embedded flag. */
		function urlChanges( url ) {
			var changes = [ { path: field.path, value: url } ];
			var parent = getAt( parse( getText() ).data, field.parentPath ) || {};

			if ( field.lottie && url !== field.value ) {
				changes.push( { path: field.parentPath.concat( 'u' ), value: '' } );
				if ( 'e' in parent ) {
					changes.push( { path: field.parentPath.concat( 'e' ), value: 0 === url.indexOf( 'data:' ) ? 1 : 0 } );
				}
			}
			return changes;
		}

		$input.on( 'change', function () {
			var url = $.trim( $input.val() );
			if ( url && apply( urlChanges( url ) ) ) {
				refresh( url );
			}
		} );

		$button.on( 'click', function () {
			openMedia( field.kind, function ( media ) {
				var changes = urlChanges( media.url );
				var parent = getAt( parse( getText() ).data, field.parentPath ) || {};

				// Unicorn Studio image layers store the source image size; keep it accurate for the new image.
				if ( 'image' === field.kind && media.width && media.height && 'naturalWidth' in parent && 'naturalHeight' in parent ) {
					changes.push( { path: field.parentPath.concat( 'naturalWidth' ), value: media.width } );
					changes.push( { path: field.parentPath.concat( 'naturalHeight' ), value: media.height } );
				}

				if ( apply( changes ) ) {
					$input.val( media.url );
					refresh( media.url );
				}
			} );
		} );

		if ( $preview ) {
			$row.addClass( 'has-preview' ).append( $preview );
		}
		$row.append( $( '<div class="jme-field-control">' ).append( $input, $( '<p>' ).append( $button ) ) );

		if ( 'font' === field.kind ) {
			$row.find( '.jme-field-control' ).append( group.font.$info, $( '<p class="description">' ).text( t( 'fontHint', '' ) ) );
		}
	}

	function renderColorField( field, $row ) {
		var values = Array.isArray( field.value ) ? field.value : [ field.value ];
		var $wrap = $( '<div class="jme-field-control jme-colors">' );

		values.forEach( function ( color, i ) {
			var path = Array.isArray( field.value ) ? field.path.concat( i ) : field.path;
			var $text = $( '<input type="text" class="code jme-color-text">' ).val( color ).attr( 'data-path', JSON.stringify( path ) );
			var $picker = $( '<input type="color" class="jme-color-picker">' );

			function syncPicker( value ) {
				if ( /^#[0-9a-f]{6}$/i.test( value ) ) {
					$picker.val( value.toLowerCase() );
				}
			}
			syncPicker( color );

			var sub = Array.isArray( field.value ) ? [ i ] : [];

			$picker.on( 'input', function () {
				var value = $picker.val().toUpperCase();
				$text.val( value );
				apply( linkedChanges( field, value, sub ) );
			} );
			$text.on( 'change', function () {
				var value = $.trim( $text.val() );
				if ( HEX_COLOR.test( value ) ) {
					syncPicker( value );
					apply( linkedChanges( field, value, sub ) );
				}
			} );

			$wrap.append( $( '<span class="jme-color">' ).append( $picker, $text ) );
		} );

		$row.append( $wrap );
	}

	function renderValueField( field, group, $row ) {
		var $input;

		if ( 'textarea' === field.kind ) {
			$input = $( '<textarea rows="3" class="large-text">' );
		} else if ( 'align' === field.kind ) {
			$input = $( '<select>' );
			[ 'left', 'center', 'right', 'justify' ].concat( [ field.value ] ).forEach( function ( v, i, all ) {
				if ( all.indexOf( v ) === i ) {
					$input.append( $( '<option>' ).val( v ).text( v ) );
				}
			} );
		} else if ( 'number' === field.kind ) {
			$input = $( '<input type="number" step="any">' );
		} else {
			$input = $( '<input type="text">' ).addClass( 'text-content' === field.kind ? 'large-text' : '' );
		}

		$input.val( field.value ).attr( 'data-path', JSON.stringify( field.path ) );

		$input.on( 'text-content' === field.kind || 'textarea' === field.kind ? 'input' : 'change', function () {
			var value = castLike( field.value, $input.val() );
			var synced = apply( linkedChanges( field, value, [] ), FAMILY_KEYS.test( field.key ) ? group.path : null );

			if ( synced ) {
				updateInputs( synced );
				if ( group.refreshTypography ) {
					group.refreshTypography();
				}
				if ( 'text-content' === field.kind || 'textarea' === field.kind ) {
					$fields.find( '.jme-font-preview' ).filter( function () {
						return $( this ).closest( '.jme-group' ).is( $row.closest( '.jme-group' ) );
					} ).text( String( value ).slice( 0, 40 ) );
				}
			}
		} );

		$row.append( $( '<div class="jme-field-control">' ).append( $input ) );
	}

	function renderFields() {
		var result = parse( getText() );
		if ( ! result.ok ) {
			return;
		}

		var groups = findFields( result.data );
		$fields.empty();

		if ( ! groups.length ) {
			$fields.append( $( '<p class="jme-muted">' ).text( t( 'noFields', '' ) ) );
			return;
		}

		groups.forEach( function ( group, index ) {
			var $group = $( '<div class="jme-group">' ).append( $( '<h3>' ).text( groupTitle( group, index ) ) );
			var main = group.fields.filter( isMainField );
			var styles = group.fields.filter( function ( f ) {
				return ! isMainField( f );
			} );
			var used = [];
			var $fontSection = null;

			// Texts first, then files; each font file is followed by the styles of its own object (e.g. fontCSS.family).
			main.sort( function ( a, b ) {
				return mainOrder( a ) - mainOrder( b );
			} ).forEach( function ( field ) {
				$group.append( renderRow( field, group ) );

				if ( 'font' === field.kind ) {
					var own = styles.filter( function ( f ) {
						return ! f.breakpoint && samePath( f.parentPath, field.parentPath );
					} );
					used = used.concat( own );
					if ( own.length ) {
						$fontSection = renderStyleGrid( '', own, group );
						$group.append( $fontSection );
					}
				}
			} );

			// Unicorn Studio text: one Weight control instead of the confusing fontStyle / fontWeight pair.
			var owner = getAt( result.data, group.path );
			var technical = [];
			if ( isUnicornText( owner ) ) {
				technical = styles.filter( function ( f ) {
					return ! f.breakpoint && samePath( f.parentPath, group.path ) && ( 'fontStyle' === f.key || 'fontWeight' === f.key );
				} );
				used = used.concat( technical );
				if ( ! $fontSection ) {
					$fontSection = renderStyleGrid( t( 'fontSection', 'Font' ), [], group );
					$group.append( $fontSection );
				}
				renderTypography( group, $fontSection );
			}

			var rest = styles.filter( function ( f ) {
				// A font family already shown next to its font file is kept in sync, so show it once.
				return -1 === used.indexOf( f ) && ! ( FAMILY_KEYS.test( f.key ) && used.some( function ( u ) {
					return FAMILY_KEYS.test( u.key ) && u.value === f.value;
				} ) );
			} );
			var sections = screenSections( group, result.data, rest );

			if ( sections.responsive ) {
				$group.append( $( '<p class="description jme-bp-note">' ).text( t( 'bpNote', '' ) ) );
			}
			sections.list.forEach( function ( section ) {
				$group.append( renderStyleGrid( section.title, section.fields, group ) );
			} );

			if ( technical.length ) {
				$group.append( renderStyleGrid( t( 'technical', 'Technical values' ), technical, group ).addClass( 'jme-tech-only' ) );
			}

			$fields.append( $group );
		} );
	}

	/** Load the font file details; when the user picked a new file, register it with the file's real weight. */
	function loadFontInfo( group, picked ) {
		var font = group.font;
		var url = font.url;

		font.info = undefined;
		font.$info.text( t( 'readingFont', 'Reading font file…' ) );
		updatePreview( group );

		fontInfo( url ).then( function ( info ) {
			if ( font.url !== url ) {
				return;
			}
			font.info = info;
			font.$info.text( describeFont( info ) );

			var owner = getAt( parse( getText() ).data, group.path );
			if ( picked && info && ! info.axis && isUnicornText( owner ) && registeredWeight( owner ) !== info.weight ) {
				apply( [ { path: group.path.concat( 'fontWeight' ), value: castLike( owner.fontWeight, String( info.weight ) ) } ] );
				updateInputs( [ { path: group.path.concat( 'fontWeight' ), value: String( info.weight ) } ] );
			}

			if ( group.refreshTypography ) {
				group.refreshTypography();
			} else {
				updatePreview( group );
			}
		} );
	}

	/** Re-render the font preview the way the animation draws it. */
	function updatePreview( group ) {
		var font = group.font;
		if ( ! font ) {
			return;
		}

		var owner = getAt( parse( getText() ).data, group.path ) || {};
		var unicorn = isUnicornText( owner );
		var drawn = unicorn ? drawnStyle( owner ) : { italic: false, weight: 400 };
		var descriptors = unicorn ? { style: drawn.italic ? 'italic' : 'normal', weight: String( registeredWeight( owner ) ) } : {};
		var key = font.url + '|' + JSON.stringify( descriptors );

		if ( font.previewKey !== key ) {
			font.previewKey = key;
			previewFont( font.url, font.$preview, descriptors );
		}
		font.$preview.css( { 'font-weight': unicorn ? drawn.weight : '', 'font-style': drawn.italic ? 'italic' : '' } );
	}

	/**
	 * Weight dropdown and plain-language notes for a Unicorn Studio text layer.
	 *
	 * No italic option: Unicorn registers the font file as italic when fontStyle contains
	 * "italic", so browsers never slant an upright file and the setting has no visible effect.
	 */
	function renderTypography( group, $section ) {
		var $grid = $section.find( '.jme-style-grid' );
		var $weight = $( '<select>' );
		var $notes = $( '<div class="jme-notes">' );

		WEIGHTS.forEach( function ( w ) {
			$weight.append( $( '<option>' ).val( w[ 0 ] ).text( weightName( w[ 0 ] ) ) );
		} );

		$grid.append(
			$( '<div class="jme-style">' ).append( $( '<label>' ).text( t( 'weight', 'Weight' ) ), $( '<div class="jme-field-control">' ).append( $weight ) )
		);
		$section.append( $notes );

		function setStyle( value ) {
			apply( [ { path: group.path.concat( 'fontStyle' ), value: value } ] );
			updateInputs( [ { path: group.path.concat( 'fontStyle' ), value: value } ] );
			refresh();
		}

		function note( message, action, onAction ) {
			var $note = $( '<p class="jme-note">' ).text( message );
			if ( action ) {
				$note.append( ' ', $( '<button type="button" class="button button-small">' ).text( action ).on( 'click', onAction ) );
			}
			$notes.append( $note );
		}

		function refresh() {
			var owner = getAt( parse( getText() ).data, group.path ) || {};
			var drawn = drawnStyle( owner );
			var info = group.font ? group.font.info : null;

			if ( ! $weight.find( 'option[value="' + drawn.weight + '"]' ).length ) {
				$weight.append( $( '<option>' ).val( drawn.weight ).text( weightName( drawn.weight ) ) );
			}
			$weight.val( drawn.weight );
			$notes.empty();

			// Browsers look at the real weight inside the file (not fontWeight): they only add a
			// synthetic bold, one fixed step, when 600+ is requested from a file lighter than 600.
			if ( info && ! info.axis ) {
				var useFileWeight = [
					t( 'useWeight', 'Use %s' ).replace( '%s', weightName( info.weight ) ),
					function () {
						setStyle( String( info.weight ) );
					},
				];

				if ( drawn.weight < info.weight ) {
					note(
						t( 'thinner', 'This font file only contains %1$s, so a thinner weight won\'t show. Upload a font file in %2$s for this weight.' ).replace( '%1$s', weightName( info.weight ) ).replace( '%2$s', weightName( drawn.weight ) ),
						useFileWeight[ 0 ],
						useFileWeight[ 1 ]
					);
				} else if ( drawn.weight > info.weight && drawn.weight >= 600 && info.weight < 600 ) {
					note( t( 'fakeBold', 'This font file is %1$s, so the browser thickens it artificially, and every weight from 600 up looks the same. Upload a font file in %2$s for a real %2$s.' ).replace( '%1$s', weightName( info.weight ) ).replace( /%2\$s/g, weightName( drawn.weight ) ) );
				} else if ( drawn.weight > info.weight ) {
					note(
						t( 'notThicker', 'This font file only contains %1$s, so it won\'t look thicker. Upload a font file in %2$s for this weight.' ).replace( '%1$s', weightName( info.weight ) ).replace( '%2$s', weightName( drawn.weight ) ),
						useFileWeight[ 0 ],
						useFileWeight[ 1 ]
					);
				}
			}

			updatePreview( group );
		}

		$weight.on( 'change', function () {
			setStyle( String( $weight.val() ) );
		} );

		group.refreshTypography = refresh;
		refresh();
	}

	/** Changes for a field plus its linked duplicates (unused copies that held the same value). */
	function linkedChanges( field, value, sub ) {
		return [ field.path ].concat( field.links || [] ).map( function ( path ) {
			return { path: path.concat( sub ), value: value };
		} );
	}

	/**
	 * Arrange style fields the way Unicorn Studio applies them (setBreakpointValues):
	 * breakpoints are checked from the smallest to the largest and a breakpoint applies
	 * when screen width <= its max (min is not checked; Desktop has no max), the first
	 * one defining a property wins, and the layer's own value is the fallback. With only
	 * a Desktop breakpoint, the layer's own values are used.
	 *
	 * Each property is shown once per group of screens that use the same stored value;
	 * unused copies with the same value are linked so they stay identical.
	 *
	 * @return {Object} { responsive: bool, list: [ { title, fields } ] }
	 */
	function screenSections( group, data, styles ) {
		var owner = getAt( data, group.path ) || {};
		var bps = Array.isArray( owner.breakpoints ) ? owner.breakpoints : [];
		var desktop = bps.filter( function ( bp ) {
			return 'Desktop' === bp.name;
		} )[ 0 ];
		var responsive = !! desktop && bps.length > 1;

		if ( ! responsive ) {
			// No breakpoints applied: the layer's own values are used, breakpoint copies are not.
			var base = styles.filter( function ( f ) {
				return ! f.breakpoint;
			} );
			base.forEach( function ( f ) {
				f.links = styles.filter( function ( o ) {
					return o.breakpoint && o.key === f.key && JSON.stringify( o.value ) === JSON.stringify( f.value );
				} ).map( function ( o ) {
					return o.path;
				} );
			} );
			return { responsive: false, list: base.length ? [ { title: t( 'baseStyle', 'Style' ), fields: base } ] : [] };
		}

		var ordered = bps.map( function ( bp, i ) {
			return { bp: bp, index: i };
		} ).sort( function ( a, b ) {
			return ( a.bp.min || 0 ) - ( b.bp.min || 0 );
		} );
		var smaller = ordered.filter( function ( o ) {
			return null != o.bp.max;
		} ).sort( function ( a, b ) {
			return a.bp.max - b.bp.max;
		} );

		// Representative screens: one per breakpoint with a max, then Desktop.
		var screens = smaller.map( function ( o, i ) {
			// The smallest breakpoint also applies below its min, i.e. on mobile.
			var name = 0 === i ? o.bp.name + ' ' + t( 'andSmaller', '& smaller' ) : o.bp.name;
			var range = 0 === i ? '≤' + o.bp.max + 'px' : ( smaller[ i - 1 ].bp.max + 1 ) + '–' + o.bp.max + 'px';
			return { width: o.bp.max, label: name + ' (' + range + ')' };
		} );
		screens.push( { width: Infinity, label: desktop.name + ' (≥' + ( smaller.length ? smaller[ smaller.length - 1 ].bp.max + 1 : desktop.min || 0 ) + 'px)' } );

		function bpIndex( field ) {
			var at = field.parentPath.lastIndexOf( 'breakpoints' );
			return at > -1 ? field.parentPath[ at + 1 ] : null;
		}

		function source( key, width ) {
			for ( var i = 0; i < ordered.length; i++ ) {
				var bp = ordered[ i ].bp;
				if ( ( null == bp.max || width <= bp.max ) && bp.props && key in bp.props ) {
					return ordered[ i ].index;
				}
			}
			return key in owner ? 'base' : null;
		}

		var keys = [];
		styles.forEach( function ( f ) {
			if ( -1 === keys.indexOf( f.key ) ) {
				keys.push( f.key );
			}
		} );

		var sections = {};
		var order = [];

		keys.forEach( function ( key ) {
			var copies = styles.filter( function ( f ) {
				return f.key === key && ( ! f.breakpoint || null !== bpIndex( f ) );
			} );
			var byCopy = {};

			screens.forEach( function ( screen ) {
				var src = source( key, screen.width );
				var copy = copies.filter( function ( f ) {
					return 'base' === src ? ! f.breakpoint : f.breakpoint && bpIndex( f ) === src;
				} )[ 0 ];
				if ( copy ) {
					var id = JSON.stringify( copy.path );
					byCopy[ id ] = byCopy[ id ] || { field: copy, screens: [] };
					byCopy[ id ].screens.push( screen );
				}
			} );

			var used = Object.keys( byCopy ).map( function ( id ) {
				return byCopy[ id ].field;
			} );

			Object.keys( byCopy ).forEach( function ( id ) {
				var entry = byCopy[ id ];
				var all = entry.screens.length === screens.length;
				var title = all ? t( 'allScreens', 'All screens' ) : entry.screens.map( function ( s ) {
					return s.label;
				} ).reverse().join( ' + ' );

				entry.field.links = copies.filter( function ( c ) {
					return -1 === used.indexOf( c ) && JSON.stringify( c.value ) === JSON.stringify( entry.field.value );
				} ).map( function ( c ) {
					return c.path;
				} );

				if ( ! sections[ title ] ) {
					sections[ title ] = { title: title, fields: [], rank: all ? -1 : screens.length - screens.indexOf( entry.screens[ 0 ] ) };
					order.push( title );
				}
				sections[ title ].fields.push( entry.field );
			} );
		} );

		return {
			responsive: true,
			list: order.map( function ( title ) {
				return sections[ title ];
			} ).sort( function ( a, b ) {
				return a.rank - b.rank;
			} ),
		};
	}

	function isMainField( field ) {
		return [ 'text-content', 'textarea', 'image', 'font', 'file' ].indexOf( field.kind ) > -1;
	}

	function mainOrder( field ) {
		return { 'text-content': 0, textarea: 0, font: 1, image: 2, file: 3 }[ field.kind ];
	}

	function samePath( a, b ) {
		return JSON.stringify( a ) === JSON.stringify( b );
	}

	function renderRow( field, group ) {
		var $row = $( '<div class="jme-field">' ).addClass( 'jme-field-' + field.kind );
		$row.append(
			$( '<div class="jme-field-label">' ).append(
				$( '<strong>' ).text( fieldLabel( field ) ),
				$( '<code class="jme-path">' ).text( pathLabel( field.path ) )
			)
		);

		if ( 'image' === field.kind || 'font' === field.kind || 'file' === field.kind ) {
			renderUrlField( field, group, $row );
		} else {
			renderValueField( field, group, $row );
		}
		return $row;
	}

	function renderStyleGrid( title, fields, group ) {
		var $section = $( '<div class="jme-styles">' );
		var $grid = $( '<div class="jme-style-grid">' );

		if ( title ) {
			$section.append( $( '<h4>' ).text( title ) );
		}

		fields.forEach( function ( field ) {
			var $cell = $( '<div class="jme-style">' ).attr( 'title', [ field.path ].concat( field.links || [] ).map( pathLabel ).join( '\n' ) );
			$cell.append( $( '<label>' ).text( t( 'label_' + field.key, field.label ) ) );

			if ( 'color' === field.kind ) {
				renderColorField( field, $cell );
			} else {
				renderValueField( field, group, $cell );
			}
			$grid.append( $cell );
		} );

		return $section.append( $grid );
	}

	// Display the JSON indented; JSON.parse/stringify changes whitespace only.
	var initial = parse( $textarea.val() );
	if ( initial.ok ) {
		$textarea.val( pretty( initial.data ) );
	} else {
		showError( t( 'invalidLoad', '' ) );
	}

	if ( window.wp && wp.codeEditor && config.codeEditor ) {
		editor = wp.codeEditor.initialize( $textarea, config.codeEditor ).codemirror;
		editor.on( 'change', function ( cm, change ) {
			if ( 'setValue' !== change.origin ) {
				markDirty();
				clearTimeout( rescanTimer );
				rescanTimer = setTimeout( renderFields, 600 );
			}
		} );
	} else {
		$textarea.on( 'input', markDirty );
	}

	renderFields();

	var $tech = $( '#jme-tech' );
	try {
		$tech.prop( 'checked', '1' === window.localStorage.getItem( 'jmeShowTech' ) );
	} catch ( e ) {}
	$fields.toggleClass( 'show-tech', $tech.is( ':checked' ) );
	$tech.on( 'change', function () {
		$fields.toggleClass( 'show-tech', $tech.is( ':checked' ) );
		try {
			window.localStorage.setItem( 'jmeShowTech', $tech.is( ':checked' ) ? '1' : '0' );
		} catch ( e ) {}
	} );

	$( '#jme-form' ).on( 'submit', function ( event ) {
		var result = parse( getText() );

		if ( ! result.ok ) {
			event.preventDefault();
			showError( t( 'invalid', '' ) + ' ' + result.message );
			$( 'html, body' ).animate( { scrollTop: $error.offset().top - 60 }, 200 );
			return;
		}

		$textarea.val( $( '#jme-minify' ).is( ':checked' ) ? JSON.stringify( result.data ) : getText() );
		dirty = false;
	} );

	$( window ).on( 'beforeunload', function () {
		return dirty ? t( 'confirmLeave', '' ) : undefined;
	} );
} )( jQuery );
