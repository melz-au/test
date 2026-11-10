import { Route, Routes } from 'react-router-dom'
import ScrollManager from './components/ScrollManager'
import Home from './pages/Home'
import About from './pages/About'
import Blog from './pages/Blog'
import BlogPost from './pages/BlogPost'
import NewBlogPost from './pages/NewBlogPost'
import WorkPost from './pages/WorkPost'
import { AdminEditPost, AdminHome, AdminNewPost } from './pages/Admin'
import NotFound from './pages/NotFound'

export default function App() {
  return (
    <>
      <ScrollManager />
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/about" element={<About />} />
        <Route path="/blog" element={<Blog />} />
        {import.meta.env.DEV && <Route path="/blog/new" element={<NewBlogPost />} />}
        <Route path="/blog/:slug" element={<BlogPost />} />
        <Route path="/work-posts/:slug" element={<WorkPost />} />
        <Route path="/admin" element={<AdminHome />} />
        <Route path="/admin/new" element={<AdminNewPost />} />
        <Route path="/admin/edit/:slug" element={<AdminEditPost />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  )
}
