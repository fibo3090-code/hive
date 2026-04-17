import { Outlet, useLocation } from 'react-router-dom';
import { HiveSidebar } from './HiveSidebar';
import { TopBar } from './TopBar';
import { AnimatePresence, motion } from 'framer-motion';

export function AppLayout() {
  const location = useLocation();

  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <HiveSidebar />
      <div className="flex flex-1 flex-col overflow-hidden">
        <TopBar />
        <main className="flex-1 overflow-auto scrollbar-thin">
          <AnimatePresence mode="wait">
            <motion.div
              key={location.pathname}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.15, ease: 'easeOut' }}
              className="h-full"
            >
              <Outlet />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
    </div>
  );
}
