use std::collections::HashMap;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Mutex};

use crate::drivers::{DriverConnection, DriverSession};

/// A pinned session together with the connection it belongs to, so closing a
/// connection can take its sessions down with it.
pub struct SessionEntry {
    pub connection_id: String,
    pub session: DriverSession,
}

/// Application state shared across all Tauri commands.
pub struct AppState {
    /// Active database connections keyed by connection ID.
    pub connections: Mutex<HashMap<String, DriverConnection>>,
    /// Pinned sessions keyed by SQL editor tab ID. A session outlives the
    /// mounting/unmounting of its tab component — it is closed when the tab is
    /// closed or its connection goes away, not when the user looks elsewhere.
    pub sessions: Mutex<HashMap<String, SessionEntry>>,
    /// Per-export cancellation flags. The frontend allocates an `export_id`
    /// up-front, the streaming command consults the flag between rows, and
    /// `cancel_export` flips it from a separate command invocation.
    pub cancellations: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            connections: Mutex::new(HashMap::new()),
            sessions: Mutex::new(HashMap::new()),
            cancellations: Mutex::new(HashMap::new()),
        }
    }

    /// Register a cancellation token for an export and return the shared flag.
    /// Replaces any existing token for the same id (stale token from a
    /// previous, completed export).
    pub fn register_cancel(&self, export_id: &str) -> Arc<AtomicBool> {
        let flag = Arc::new(AtomicBool::new(false));
        self.cancellations
            .lock()
            .unwrap()
            .insert(export_id.to_string(), flag.clone());
        flag
    }

    pub fn signal_cancel(&self, export_id: &str) {
        if let Some(flag) = self.cancellations.lock().unwrap().get(export_id) {
            flag.store(true, std::sync::atomic::Ordering::Relaxed);
        }
    }

    pub fn drop_cancel(&self, export_id: &str) {
        self.cancellations.lock().unwrap().remove(export_id);
    }

    /// Remove every session belonging to a connection, returning them so the
    /// caller can close them outside the lock.
    pub fn take_sessions_for(&self, connection_id: &str) -> Vec<DriverSession> {
        let mut sessions = self.sessions.lock().unwrap();
        let ids: Vec<String> = sessions
            .iter()
            .filter(|(_, entry)| entry.connection_id == connection_id)
            .map(|(id, _)| id.clone())
            .collect();
        ids.iter()
            .filter_map(|id| sessions.remove(id))
            .map(|entry| entry.session)
            .collect()
    }
}

impl Default for AppState {
    fn default() -> Self {
        Self::new()
    }
}
