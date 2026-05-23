import { Navigate, Route, Routes } from 'react-router-dom';
import { SessionProvider } from './state/sessionContext.js';
import ChatView from './components/ChatView.js';
import SignInScreen from './components/SignInScreen.js';

// Placeholder — replaced in Part C
function Dashboards() {
  return <div>dashboards</div>;
}

export default function App() {
  return (
    <SessionProvider>
      <Routes>
        <Route path="/" element={<ChatView />} />
        <Route path="/c/:id" element={<ChatView />} />
        <Route path="/dashboards" element={<Dashboards />} />
        <Route path="/sign-in" element={<SignInScreen onSignIn={() => undefined} />} />
        <Route path="*" element={<Navigate to="/" />} />
      </Routes>
    </SessionProvider>
  );
}
