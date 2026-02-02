use std::collections::HashMap;
use std::sync::Mutex;

use crate::drivers::DriverConnection;

/// Application state shared across all Tauri commands.
pub struct AppState {
    /// Active database connections keyed by connection ID.
    pub connections: Mutex<HashMap<String, DriverConnection>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
        }
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
