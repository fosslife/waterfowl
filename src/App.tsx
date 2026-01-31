import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AppLayout } from "./layouts/AppLayout";
import { Welcome } from "./pages/Welcome";
import { NewConnection } from "./pages/NewConnection";
import { ConnectionDetails } from "./pages/ConnectionDetails";
import { ConnectionsProvider } from "./context/ConnectionsContext";

function App() {
  return (
    <ConnectionsProvider>
      <BrowserRouter>
        <Routes>
          <Route element={<AppLayout />}>
            <Route path="/" element={<Welcome />} />
            <Route path="/new-connection" element={<NewConnection />} />
            <Route path="/connection/:id" element={<ConnectionDetails />} />
          </Route>
        </Routes>
      </BrowserRouter>
    </ConnectionsProvider>
  );
}

export default App;
