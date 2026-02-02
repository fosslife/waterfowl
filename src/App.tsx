import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Welcome } from "./pages/Welcome";
import { NewConnection } from "./pages/NewConnection";
import { ConnectionDetails } from "./pages/ConnectionDetails";
import { ConnectionsProvider } from "./context/ConnectionsContext";
import { ToastProvider } from "./context/ToastContext";

function App() {
  return (
    <ToastProvider>
      <ConnectionsProvider>
        <BrowserRouter>
          <Routes>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Welcome />} />
              <Route path="/new-connection" element={<NewConnection />} />
              <Route path="/edit-connection/:id" element={<NewConnection />} />
              <Route path="/connection/:id" element={<ConnectionDetails />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </ConnectionsProvider>
    </ToastProvider>
  );
}

export default App;
