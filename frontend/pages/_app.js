import { useState, useEffect } from 'react';
import { useRouter } from 'next/router';
import { axios } from '@/library/_axios';
import Layout from '@/components/Layout/Layout';
import ErrorBoundary from '@/components/Layout/ErrorBoundary';
import Toast from '@/components/Layout/Toast';
import "@/styles/globals.scss";
import "@/styles/fonts.css";
import "@/styles/components/auth/login.scss";
import "@/styles/components/modal/alert.scss";
import "@/styles/components/setup/setup.scss";
import "@/styles/components/layout/layout.scss";
import "@/styles/components/layout/header.scss";
import "@/styles/components/layout/sidebar.scss";
import "@/styles/components/modal/commandPalette.scss";
import "@/styles/components/modal/createBranch.scss";
import "@/styles/components/layout/footer.scss";
import "@/styles/components/messenger/messenger.scss";
import "@/styles/components/messenger/messengerChatList.scss";
import "@/styles/components/messenger/messengerUserList.scss";
import "@/styles/components/messenger/messengerChatRoom.scss";
import "@/styles/components/messenger/messengerNewChat.scss";
import "@/styles/components/messenger/taskSearchPopup.scss";
import "@/styles/components/messenger/taskRefCard.scss";
import "@/styles/components/messenger/docSearchPopup.scss";
import "@/styles/components/messenger/docRefCard.scss";
import "@/styles/components/messenger/issueSearchPopup.scss";
import "@/styles/components/messenger/issueRefCard.scss";
import "@/styles/components/admin/admin.scss";
import "@/styles/components/admin/adminSidebar.scss";
import "@/styles/components/modal/addMember.scss";
import "@/styles/components/branch/branchDetail.scss";
import "@/styles/components/branch/taskList.scss";
import "@/styles/components/modal/taskModal.scss";
import "@/styles/components/modal/sprintModal.scss";
import "@/styles/components/modal/confirmModal.scss";
import "@/styles/components/branch/boardView.scss";
import "@/styles/components/branch/archiveList.scss";
import "@/styles/components/branch/epicTimeline.scss";
import "@/styles/components/modal/epicModal.scss";
import "@/styles/components/branch/taskDetailPanel.scss";
import "@/styles/components/profile/profile.scss";
import "@/styles/components/common/customSelect.scss";
import "@/styles/components/common/labelTagInput.scss";
import "@/styles/components/common/multiSelect.scss";
import "@/styles/components/branch/branchSettings.scss";
import "@/styles/components/browse/browseBranches.scss";
import "@/styles/components/home/launchpad.scss";
import "@/styles/components/home/dashboard.scss";
import "@/styles/components/home/widget.scss";
import "@/styles/components/modal/createCanvas.scss";
import "@/styles/components/branch/branchHome.scss";
import "@/styles/components/canvas/canvasHome.scss";
import "@/styles/components/canvas/canvasOverview.scss";
import "@/styles/components/canvas/canvasPageView.scss";
import "@/styles/components/canvas/canvasEditor.scss";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.min.css";
import "@/styles/components/canvas/canvasCollabEditor.scss";
import "@/styles/components/canvas/canvasSettings.scss";
import "@/styles/components/canvas/refPreviewPanel.scss";
import "@/styles/components/canvas/typstEditor.scss";
import "@/styles/components/canvas/annotation.scss";
import "@/styles/components/branch/taskFullPage.scss";
import "@/styles/components/branch/taskIssueSection.scss";
import "@/styles/components/branch/taskIssueDetail.scss";
import "@/styles/components/branch/createIssuePage.scss";
import "@/styles/components/myTasks/myTasks.scss";
import "@/styles/components/layout/toast.scss";
import "@/styles/components/home/ai-chat.scss";
import "@/styles/components/branch/epicFlow.scss";
import "@/styles/components/branch/branchSchedule.scss";
import "@/styles/components/modal/scheduleEventModal.scss";
import "@/styles/components/modal/jiraMigrationModal.scss";

const publicPaths = ['/auth/login', '/setup'];
const noLayoutPaths = ['/auth/login', '/setup', '/admin'];

export default function App({ Component, pageProps }) {
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);

  useEffect(() => {
    checkAppState();
  }, [router.pathname]);

  const checkAppState = async () => {
    setAppReady(false);

    // 초기화 여부: sessionStorage 캐시 우선, 없을 때만 API 호출
    let initialized = sessionStorage.getItem('app_initialized') === 'true';
    if (!initialized) {
      try {
        const res = await axios.get('/setup/status');
        initialized = res.data.initialized;
        if (initialized) {
          sessionStorage.setItem('app_initialized', 'true');
        }
      } catch {
        // API 실패 시: 프로필 캐시 없으면 로그인으로
        if (!sessionStorage.getItem('profile') && router.pathname !== '/auth/login') {
          router.replace('/auth/login');
          return;
        }
        setAppReady(true);
        return;
      }
    }

    // 인증 상태 확인: 캐시된 프로필 우선, 없으면 쿠키 기반 서버 확인
    let isLoggedIn = !!sessionStorage.getItem('profile');
    if (!isLoggedIn && !publicPaths.includes(router.pathname) && router.pathname !== '/setup') {
      try {
        const res = await axios.get('/auth/me');
        if (res.data.status) {
          sessionStorage.setItem('profile', JSON.stringify(res.data.profile));
          isLoggedIn = true;
        }
      } catch {}
    }

    if (!initialized) {
      // 미초기화 상태: /setup 외 모든 경로 차단
      if (router.pathname !== '/setup') {
        router.replace('/setup');
        return;
      }
    } else if (router.pathname === '/setup') {
      // 초기화 완료 후 /setup 접근 차단
      router.replace(isLoggedIn ? '/' : '/auth/login');
      return;
    } else if (!isLoggedIn && !publicPaths.includes(router.pathname)) {
      // 미인증 + 비공개 경로
      router.replace('/auth/login');
      return;
    } else if (isLoggedIn && router.pathname === '/auth/login') {
      // 인증 상태에서 로그인 페이지 접근
      router.replace('/');
      return;
    }

    setAppReady(true);
  };

  // Service Worker 등록 (PWA)
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('/sw.js');
    }
  }, []);

  // auth:expired 이벤트 수신 (axios 인터셉터에서 발송)
  useEffect(() => {
    const handleExpired = () => {
      sessionStorage.removeItem('profile');
      router.replace('/auth/login');
    };
    window.addEventListener('auth:expired', handleExpired);
    return () => window.removeEventListener('auth:expired', handleExpired);
  }, []);

  if (!appReady) return null;

  const needsLayout = !noLayoutPaths.some(p => router.pathname.startsWith(p));

  return (
    <ErrorBoundary>
      {needsLayout
        ? <Layout><Component {...pageProps} /></Layout>
        : <Component {...pageProps} />}
      <Toast />
    </ErrorBoundary>
  );
}
