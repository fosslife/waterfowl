import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Welcome } from "./pages/Welcome";
import { NewConnection } from "./pages/connection/new/NewConnection";
import { ConnectionDetails } from "./pages/connection/details/ConnectionDetails";
import { ConnectionsProvider } from "./context/ConnectionsContext";
import { ToastProvider } from "./context/ToastContext";
import { NewConnectionModalProvider } from "./context/NewConnectionModalContext";

function App() {
  return (
    <ToastProvider>
      <ConnectionsProvider>
        <NewConnectionModalProvider>
          <BrowserRouter>
            <Routes>
              <Route element={<AppLayout />}>
                <Route path="/" element={<Welcome />} />
                <Route
                  path="/connection/edit/:id"
                  element={<NewConnection />}
                />
                <Route path="/connection/:id" element={<ConnectionDetails />} />
              </Route>
            </Routes>
          </BrowserRouter>
        </NewConnectionModalProvider>
      </ConnectionsProvider>
    </ToastProvider>
  );
}

export default App;
