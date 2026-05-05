import {
  createContext,
  useContext,
  useState,
  useCallback,
  ReactNode,
} from "react";
import { NewConnectionModal } from "../components/ui/modal/NewConnectionModal";

interface NewConnectionModalContextType {
  openNewConnectionModal: () => void;
}

const NewConnectionModalContext = createContext<
  NewConnectionModalContextType | undefined
>(undefined);

export function NewConnectionModalProvider({
  children,
}: {
  children: ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(false);

  const openNewConnectionModal = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);

  return (
    <NewConnectionModalContext.Provider value={{ openNewConnectionModal }}>
      {children}
      <NewConnectionModal isOpen={isOpen} onClose={close} />
    </NewConnectionModalContext.Provider>
  );
}

export function useNewConnectionModal() {
  const context = useContext(NewConnectionModalContext);
  if (!context) {
    throw new Error(
      "useNewConnectionModal must be used within NewConnectionModalProvider",
    );
  }
  return context;
}
