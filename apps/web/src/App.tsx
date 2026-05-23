import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './state/sessionContext.js';

// Placeholder components — replaced in later tasks (Parts B & C)
function ChatView() {
  return <div>chat</div>;
}
function Dashboards() {
  return <div>dashboards</div>;
}
function SignInScreen() {
  return <div>sign-in</div>;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<ChatView />} />
        <Route path="/c/:id" element={<ChatView />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/sign-in" element={<SignInScreen />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </SessionProvider>
  );
}
