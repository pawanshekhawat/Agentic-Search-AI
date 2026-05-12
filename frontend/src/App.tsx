import { Routes, Route } from "react-router";
import Auth from "./pages/Auth";
import { Chat } from "./pages/Chat";
export function App() {
  return (
    <Routes>
      <Route path="/" element={<Chat/>}/>
      <Route path="/c/:conversationId" element={<Chat/>}/>
      <Route path="/auth" element={<Auth/>}/>
    </Routes>
  );
}

export default App;
