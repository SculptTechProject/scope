//! Concrete ownership checks for the vendored GLib pointer conversions.
#![cfg(target_os = "linux")]

use std::{cell::Cell, rc::Rc};

use glib::{prelude::*, translate::*, Object, PtrSlice};

#[derive(glib::Boxed)]
#[boxed_type(name = "ScopeOwnershipRegressionBoxed")]
struct CountedBoxed {
    payload: String,
    clones: Rc<Cell<usize>>,
    drops: Rc<Cell<usize>>,
}

impl Clone for CountedBoxed {
    fn clone(&self) -> Self {
        self.clones.set(self.clones.get() + 1);
        Self {
            payload: self.payload.clone(),
            clones: self.clones.clone(),
            drops: self.drops.clone(),
        }
    }
}

impl Drop for CountedBoxed {
    fn drop(&mut self) {
        self.drops.set(self.drops.get() + 1);
    }
}

#[test]
fn boxed_transfer_none_clones_without_consuming_the_original_allocation() {
    let clones = Rc::new(Cell::new(0));
    let drops = Rc::new(Cell::new(0));
    let original = CountedBoxed {
        payload: "original".into(),
        clones: clones.clone(),
        drops: drops.clone(),
    };
    let raw: *mut CountedBoxed = unsafe { original.into_glib_ptr() };

    // Both generated pointer implementations must clone the concrete boxed type.
    let mut copied: CountedBoxed = unsafe { from_glib_none(raw) };
    let const_copy: CountedBoxed = unsafe { from_glib_none(raw as *const CountedBoxed) };
    assert_eq!(clones.get(), 2);
    assert_eq!(drops.get(), 0);
    copied.payload.push_str(" changed");
    assert_eq!(const_copy.payload, "original");

    let recovered: CountedBoxed = unsafe { from_glib_full(raw) };
    assert_eq!(recovered.payload, "original");
    assert_eq!(clones.get(), 2);
    drop(recovered);
    assert_eq!(drops.get(), 1);
    assert_eq!(copied.payload, "original changed");
    drop(copied);
    drop(const_copy);
    assert_eq!(drops.get(), 3);
}

#[test]
fn boxed_borrow_preserves_the_single_owner_until_full_transfer() {
    let clones = Rc::new(Cell::new(0));
    let drops = Rc::new(Cell::new(0));
    let raw: *mut CountedBoxed = unsafe {
        CountedBoxed {
            payload: "borrowed".into(),
            clones: clones.clone(),
            drops: drops.clone(),
        }
        .into_glib_ptr()
    };

    {
        let borrowed: Borrowed<CountedBoxed> = unsafe { from_glib_borrow(raw) };
        assert_eq!(borrowed.payload, "borrowed");
    }
    assert_eq!(clones.get(), 0);
    assert_eq!(drops.get(), 0);
    let recovered: CountedBoxed = unsafe { from_glib_full(raw) };
    assert_eq!(recovered.payload, "borrowed");
    drop(recovered);
    assert_eq!(drops.get(), 1);
}

#[test]
fn boxed_values_copy_and_free_each_concrete_allocation_once() {
    let clones = Rc::new(Cell::new(0));
    let drops = Rc::new(Cell::new(0));
    let original = CountedBoxed {
        payload: "value payload".into(),
        clones: clones.clone(),
        drops: drops.clone(),
    };
    let value = original.to_value();
    assert_eq!(clones.get(), 1);
    assert_eq!(
        value.get::<&CountedBoxed>().unwrap().payload,
        "value payload"
    );
    assert_eq!(clones.get(), 1);

    let copied_value = value.clone();
    let mut extracted = value.get::<CountedBoxed>().unwrap();
    assert_eq!(clones.get(), 3);
    assert!(!std::ptr::eq(
        value.get::<&CountedBoxed>().unwrap(),
        copied_value.get::<&CountedBoxed>().unwrap()
    ));
    extracted.payload.push_str(" changed");
    drop(original);
    drop(value);
    assert_eq!(drops.get(), 2);
    assert_eq!(
        copied_value.get::<&CountedBoxed>().unwrap().payload,
        "value payload"
    );
    assert_eq!(extracted.payload, "value payload changed");
    drop(copied_value);
    drop(extracted);
    assert_eq!(drops.get(), 4);
}

#[test]
fn ptr_slice_truncate_releases_pointees_and_reuses_the_live_slot_buffer() {
    let finalized = Rc::new(Cell::new(0));
    let first: Object = Object::new();
    let shared_tail: Object = Object::new();
    let unique_tail: Object = Object::new();
    let weak_tail = unique_tail.downgrade();
    for object in [&first, &shared_tail, &unique_tail] {
        let finalized = finalized.clone();
        object.add_weak_ref_notify_local(move || finalized.set(finalized.get() + 1));
    }

    let mut slice = PtrSlice::from([first.clone(), shared_tail.clone(), unique_tail]);
    let buffer = slice.as_ptr();
    let capacity = slice.capacity();
    assert_eq!(first.ref_count(), 2);
    assert_eq!(shared_tail.ref_count(), 2);
    slice.truncate(1);
    assert_eq!(slice.len(), 1);
    assert_eq!(slice[0], first);
    assert_eq!(first.ref_count(), 2);
    assert_eq!(shared_tail.ref_count(), 1);
    assert!(weak_tail.upgrade().is_none());
    assert_eq!(finalized.get(), 1);
    assert_eq!(slice.as_ptr(), buffer);
    assert_eq!(slice.capacity(), capacity);
    // The object allocations can die while the independently allocated slots
    // remain live and contain the replacement NULL values and terminator.
    unsafe {
        assert!((*buffer.add(1)).is_null());
        assert!((*buffer.add(2)).is_null());
        assert!((*buffer.add(3)).is_null());
    }

    slice.truncate(1);
    slice.truncate(8);
    assert_eq!(finalized.get(), 1);
    let replacement: Object = Object::new();
    let replacement_weak = replacement.downgrade();
    let replacement_finalized = finalized.clone();
    replacement.add_weak_ref_notify_local(move || {
        replacement_finalized.set(replacement_finalized.get() + 1)
    });
    slice.push(replacement);
    assert_eq!(slice.len(), 2);
    assert_eq!(slice.as_ptr(), buffer);
    assert_eq!(slice[1].ref_count(), 1);
    slice.truncate(0);
    assert_eq!(first.ref_count(), 1);
    assert!(replacement_weak.upgrade().is_none());
    assert_eq!(finalized.get(), 2);
    unsafe {
        assert!((*buffer).is_null());
        assert!((*buffer.add(1)).is_null());
    }
    drop(slice);
    assert_eq!(finalized.get(), 2);
    drop(first);
    drop(shared_tail);
    assert_eq!(finalized.get(), 4);
}
