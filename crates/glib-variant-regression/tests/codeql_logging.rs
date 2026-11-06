//! Concrete type checks for the UUID-to-log-level path reported by CodeQL.
#![cfg(target_os = "linux")]

use glib::translate::from_glib;

#[test]
fn uuid_validation_returns_bool_for_valid_and_invalid_input() {
    for (input, expected) in [
        ("550e8400-e29b-41d4-a716-446655440000", true),
        ("not-a-uuid", false),
        ("", false),
    ] {
        // The binding selects FromGlib<gboolean> for bool, not LogLevel's
        // distinct FromGlib<u32> implementation or its panic/logging branch.
        let valid: bool = glib::uuid_string_is_valid(input);
        assert_eq!(valid, expected);
    }
}

#[test]
fn log_level_conversion_handles_flags_and_formats_only_unknown_numeric_value() {
    for (flags, expected) in [
        (glib::ffi::G_LOG_LEVEL_ERROR, glib::LogLevel::Error),
        (glib::ffi::G_LOG_LEVEL_CRITICAL, glib::LogLevel::Critical),
        (glib::ffi::G_LOG_LEVEL_WARNING, glib::LogLevel::Warning),
        (glib::ffi::G_LOG_LEVEL_MESSAGE, glib::LogLevel::Message),
        (glib::ffi::G_LOG_LEVEL_INFO, glib::LogLevel::Info),
        (glib::ffi::G_LOG_LEVEL_DEBUG, glib::LogLevel::Debug),
    ] {
        let level: glib::LogLevel = unsafe { from_glib(flags) };
        assert_eq!(level, expected);
    }
    let panic = std::panic::catch_unwind(|| unsafe { from_glib::<u32, glib::LogLevel>(0) })
        .expect_err("zero does not contain a known logging level flag");
    let message = panic
        .downcast_ref::<String>()
        .map(String::as_str)
        .or_else(|| panic.downcast_ref::<&str>().copied())
        .expect("GLib's panic contains a text message");
    assert_eq!(message, "Unknown log level: 0");
}
