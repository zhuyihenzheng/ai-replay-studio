import { Navigate, Route, Routes } from 'react-router-dom'
import { Layout } from '@/components/Layout'
import { DashboardPage } from '@/pages/DashboardPage'
import { SessionReplayPage } from '@/pages/SessionReplayPage'
import { ToolGraphPage } from '@/pages/ToolGraphPage'
import { CostAnalysisPage } from '@/pages/CostAnalysisPage'
import { FileChangesPage } from '@/pages/FileChangesPage'
import { ArtifactsPage } from '@/pages/ArtifactsPage'
import { ClientReportPage } from '@/pages/ClientReportPage'

export default function App() {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route index element={<DashboardPage />} />
        <Route path="sessions/:id" element={<SessionReplayPage />} />
        <Route path="sessions/:id/graph" element={<ToolGraphPage />} />
        <Route path="sessions/:id/cost" element={<CostAnalysisPage />} />
        <Route path="sessions/:id/files" element={<FileChangesPage />} />
        <Route path="sessions/:id/artifacts" element={<ArtifactsPage />} />
        <Route path="sessions/:id/report" element={<ClientReportPage />} />
        <Route path="sessions" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  )
}
