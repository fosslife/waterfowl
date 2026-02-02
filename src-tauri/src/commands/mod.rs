//! Tauri command handlers.
//!
//! This module contains all the Tauri commands that are exposed to the frontend.
//! Commands are organized into submodules by functionality.

mod connections;
mod queries;

// Re-export all commands for easy registration in lib.rs
pub use connections::*;
pub use queries::*;
