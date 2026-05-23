import { Navigate, Route, Routes } from 'react-router-dom';

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
    <Routes>
      <Route path="/" element={<ChatView />} />
      <Route path="/c/:id" element={<ChatView />} />
      <Route path="/dashboards" element={<Dashboards />} />
      <Route path="/sign-in" element={<SignInScreen />} />
      <Route path="*" element={<Navigate to="/" />} />
    </Routes>
  );
}
