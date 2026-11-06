//! Concrete translation contracts behind the vendored GLib pointer alerts.
#![cfg(target_os = "linux")]

use glib::{prelude::*, translate::*};
use std::{
    path::PathBuf,
    sync::atomic::{AtomicU64, Ordering},
};

struct TempDir(PathBuf);

impl TempDir {
    fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let path = std::env::temp_dir().join(format!(
            "scope-glib-translation-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&path).unwrap();
        Self(path)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[test]
fn file_contents_out_parameter_returns_owned_error_only_on_failure() {
    let temp = TempDir::new();
    let file = temp.0.join("contents");
    glib::file_set_contents(&file, b"before\0after").unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"before\0after");

    // A regular file cannot be the parent of another file, even when run as root.
    let error = glib::file_set_contents(file.join("child"), b"unused").unwrap_err();
    assert!(error.matches(glib::FileError::Notdir));
    let copy = error.clone();
    drop(error);
    assert!(copy.matches(glib::FileError::Notdir));
    assert!(!copy.message().is_empty());
}

#[test]
fn full_file_contents_out_parameter_returns_owned_error_only_on_failure() {
    let temp = TempDir::new();
    let file = temp.0.join("contents");
    glib::file_set_contents_full(
        &file,
        b"full\0contents",
        glib::FileSetContentsFlags::NONE,
        0o600,
    )
    .unwrap();
    assert_eq!(std::fs::read(&file).unwrap(), b"full\0contents");
    let error = glib::file_set_contents_full(
        file.join("child"),
        b"unused",
        glib::FileSetContentsFlags::NONE,
        0o600,
    )
    .unwrap_err();
    assert!(error.matches(glib::FileError::Notdir));
}

#[test]
fn console_charset_out_parameter_is_a_borrowed_string() {
    let mut charset = std::ptr::null();
    // SAFETY: charset is writable storage for the borrowed C string pointer.
    let is_utf8 = unsafe { glib::ffi::g_get_console_charset(&mut charset) };
    assert!(!charset.is_null());
    // SAFETY: GLib supplies a borrowed NUL-terminated character set name.
    let charset = unsafe { std::ffi::CStr::from_ptr(charset) }
        .to_str()
        .unwrap();
    assert!(!charset.is_empty());
    match glib::console_charset() {
        Some(name) => {
            assert_ne!(is_utf8, glib::ffi::GFALSE);
            assert_eq!(name, charset);
        }
        None => assert_eq!(is_utf8, glib::ffi::GFALSE),
    }
}

#[test]
fn filename_uri_hostname_uses_nullable_string_translation() {
    let (path, hostname) = glib::filename_from_uri("file:///tmp/a%20b").unwrap();
    assert_eq!(path, PathBuf::from("/tmp/a b"));
    assert_eq!(hostname, None);

    let (path, hostname) = glib::filename_from_uri("file://example.com/tmp/a").unwrap();
    assert_eq!(path, PathBuf::from("/tmp/a"));
    assert_eq!(hostname.as_deref(), Some("example.com"));
    assert!(glib::filename_from_uri("https://example.com/a").is_err());
    assert!(glib::filename_to_uri("relative", None).is_err());
    assert_eq!(
        glib::filename_to_uri("/tmp/a b", None).unwrap(),
        "file:///tmp/a%20b"
    );
}

#[test]
fn uri_split_preserves_absent_components_and_an_empty_path() {
    let (scheme, userinfo, host, port, path, query, fragment) =
        glib::Uri::split("", glib::UriFlags::NONE).unwrap();
    assert_eq!(
        (scheme, userinfo, host, port, path.as_str(), query, fragment),
        (None, None, None, -1, "", None, None)
    );
    let (scheme, host, port) =
        glib::Uri::split_network("https://example.com:8443", glib::UriFlags::NONE).unwrap();
    assert_eq!(scheme.as_deref(), Some("https"));
    assert_eq!(host.as_deref(), Some("example.com"));
    assert_eq!(port, 8443);
    assert!(glib::Uri::split_network("relative", glib::UriFlags::NONE).is_err());

    let flags = glib::UriFlags::HAS_PASSWORD | glib::UriFlags::HAS_AUTH_PARAMS;
    let (scheme, user, password, auth, host, port, path, query, fragment) =
        glib::Uri::split_with_user("https://user:pass;auth@example.com:8443/path?q#f", flags)
            .unwrap();
    assert_eq!(scheme.as_deref(), Some("https"));
    assert_eq!(user.as_deref(), Some("user"));
    assert_eq!(password.as_deref(), Some("pass"));
    assert_eq!(auth.as_deref(), Some("auth"));
    assert_eq!(host.as_deref(), Some("example.com"));
    assert_eq!(port, 8443);
    assert_eq!(path, "/path");
    assert_eq!(query.as_deref(), Some("q"));
    assert_eq!(fragment.as_deref(), Some("f"));
    let (_, user, password, auth, _, _, path, query, fragment) =
        glib::Uri::split_with_user("", flags).unwrap();
    assert_eq!(
        (user, password, auth, path.as_str(), query, fragment),
        (None, None, None, "", None, None)
    );
    assert!(glib::Uri::split("https://[invalid", glib::UriFlags::NONE).is_err());
    assert!(glib::Uri::split_with_user("https://[invalid", flags).is_err());
}

#[test]
fn key_file_errors_preserve_domain_and_success_values() {
    let key = glib::KeyFile::new();
    key.load_from_data(
        "[group]\nnumber=42\nfloat=1.5\ntext=hello\n",
        glib::KeyFileFlags::NONE,
    )
    .unwrap();
    assert_eq!(key.integer("group", "number").unwrap(), 42);
    assert_eq!(key.double("group", "float").unwrap(), 1.5);
    assert_eq!(key.value("group", "text").unwrap(), "hello");
    assert!(key
        .integer("group", "text")
        .unwrap_err()
        .matches(glib::KeyFileError::InvalidValue));
    assert!(key
        .value("group", "missing")
        .unwrap_err()
        .matches(glib::KeyFileError::KeyNotFound));
    assert!(key
        .remove_group("missing")
        .unwrap_err()
        .matches(glib::KeyFileError::GroupNotFound));
}

#[test]
fn shell_and_conversion_errors_are_errors_instead_of_object_or_value_pointers() {
    let argv = glib::shell_parse_argv("command 'two words' ''").unwrap();
    assert_eq!(argv, ["command", "two words", ""]);
    assert_eq!(
        glib::shell_parse_argv("'unterminated")
            .unwrap_err()
            .domain(),
        glib::Quark::from_str("g-shell-error-quark")
    );
    assert_eq!(glib::shell_unquote("'two words'").unwrap(), "two words");
    assert_eq!(
        glib::shell_unquote("'unterminated").unwrap_err().domain(),
        glib::Quark::from_str("g-shell-error-quark")
    );
    let (bytes, consumed) = glib::convert(b"hello", "UTF-8", "UTF-8").unwrap();
    assert_eq!(bytes.as_ref(), b"hello");
    assert_eq!(consumed, 5);
    assert!(glib::convert(&[0xff], "UTF-8", "UTF-8").is_err());
}

#[test]
fn object_pointer_translation_retains_a_live_object() {
    let object = glib::Object::new::<glib::Object>();
    let weak = object.downgrade();
    // SAFETY: the original object is alive and lends a valid GObject pointer.
    let retained: glib::Object = unsafe { from_glib_none(object.as_ptr()) };
    let pointer: *mut glib::gobject_ffi::GObject = retained.to_glib_full();
    // SAFETY: to_glib_full transfers an additional strong reference.
    let owned: glib::Object = unsafe { from_glib_full(pointer) };
    drop(object);
    drop(retained);
    assert!(weak.upgrade().is_some());
    assert_eq!(owned.type_(), glib::Object::static_type());
    drop(owned);
    assert!(weak.upgrade().is_none());
}

#[test]
fn value_pointer_copy_and_free_preserve_string_payload() {
    let value = "payload 🦀".to_value();
    // SAFETY: value lends a live initialized GValue, which is copied.
    let copied: glib::Value = unsafe {
        from_glib_none(ToGlibPtr::<*const glib::gobject_ffi::GValue>::to_glib_none(&value).0)
    };
    let pointer: *const glib::gobject_ffi::GValue = copied.to_glib_full();
    // SAFETY: to_glib_full allocated a GValue and transfers its ownership.
    let owned: glib::Value = unsafe { from_glib_full(pointer) };
    drop(value);
    drop(copied);
    assert_eq!(owned.get::<String>().unwrap(), "payload 🦀");
    assert_eq!(owned.clone().get::<String>().unwrap(), "payload 🦀");
}
