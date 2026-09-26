import { Routes, Route } from 'react-router-dom'
import Home from '@/pages/Home'
import Send from '@/pages/Send'
import Receive from '@/pages/Receive'

export default function App() {
  return (
    <div className="min-h-screen flex flex-col">
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/send" element={<Send />} />
        <Route path="/receive" element={<Receive />} />
      </Routes>
    </div>
  )
}