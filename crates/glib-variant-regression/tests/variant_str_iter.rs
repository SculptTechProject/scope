//! Optimized regression coverage for the GLib 0.18 VariantStrIter backport.
//! Run with `cargo test --release -p scope-glib-variant-regression` on Linux.
#![cfg(target_os = "linux")]

use glib::prelude::*;

#[test]
fn next_returns_each_string() {
    let value = ["first", "", "third"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("first"));
    assert_eq!(iter.next(), Some(""));
    assert_eq!(iter.next(), Some("third"));
    assert_eq!(iter.next(), None);
}

#[test]
fn last_returns_the_remaining_tail() {
    let value = ["first", "middle", "last"].to_variant();
    assert_eq!(value.array_iter_str().unwrap().last(), Some("last"));
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next_back(), Some("last"));
    assert_eq!(iter.last(), Some("middle"));
}

#[test]
fn nth_skips_from_the_front() {
    let value = ["zero", "one", "two", "three", "four"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth(1), Some("one"));
    assert_eq!(iter.len(), 3);
    assert_eq!(iter.nth(0), Some("two"));
    assert_eq!(iter.nth(1), Some("four"));
    assert_eq!(iter.next(), None);
}

#[test]
fn next_back_returns_each_string_in_reverse() {
    let value = ["first", "", "third"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next_back(), Some("third"));
    assert_eq!(iter.next_back(), Some(""));
    assert_eq!(iter.next_back(), Some("first"));
    assert_eq!(iter.next_back(), None);
}

#[test]
fn nth_back_skips_from_the_back() {
    let value = ["zero", "one", "two", "three", "four"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.nth_back(1), Some("three"));
    assert_eq!(iter.len(), 3);
    assert_eq!(iter.nth_back(0), Some("two"));
    assert_eq!(iter.nth_back(1), Some("zero"));
    assert_eq!(iter.next_back(), None);
}

#[test]
fn mixed_directions_do_not_repeat_or_cross() {
    let value = ["zero", "one", "two", "three", "four", "five"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.next(), Some("zero"));
    assert_eq!(iter.next_back(), Some("five"));
    assert_eq!(iter.nth(1), Some("two"));
    assert_eq!(iter.nth_back(1), Some("three"));
    assert_eq!(iter.len(), 0);
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
}

#[test]
fn exhaustion_stays_fused_after_out_of_range_skips() {
    let value = ["only"].to_variant();
    let mut forward = value.array_iter_str().unwrap();
    assert_eq!(forward.nth(usize::MAX), None);
    assert_eq!(forward.next(), None);
    assert_eq!(forward.next_back(), None);
    assert_eq!(forward.nth_back(0), None);
    assert_eq!(forward.last(), None);

    let mut backward = value.array_iter_str().unwrap();
    assert_eq!(backward.nth_back(usize::MAX), None);
    assert_eq!(backward.next_back(), None);
    assert_eq!(backward.next(), None);
    assert_eq!(backward.nth(0), None);
    assert_eq!(backward.last(), None);
}

#[test]
fn empty_array_has_no_strings_in_either_direction() {
    let value = Vec::<String>::new().to_variant();
    let mut iter = value.array_iter_str().unwrap();
    assert_eq!(iter.size_hint(), (0, Some(0)));
    assert_eq!(iter.next(), None);
    assert_eq!(iter.next_back(), None);
    assert_eq!(iter.nth(0), None);
    assert_eq!(iter.nth_back(0), None);
    assert_eq!(iter.last(), None);
}

#[test]
fn utf8_strings_preserve_bytes_and_borrowed_lifetimes() {
    let value = ["Zażółć gęślą jaźń", "日本語", "🦀", "e\u{301}"].to_variant();
    let mut iter = value.array_iter_str().unwrap();
    let first = iter.next().unwrap();
    assert_eq!(iter.next_back(), Some("e\u{301}"));
    assert_eq!(iter.nth(0), Some("日本語"));
    assert_eq!(iter.nth_back(0), Some("🦀"));
    assert_eq!(iter.next(), None);
    drop(iter);
    assert_eq!(first, "Zażółć gęślą jaźń");
}
