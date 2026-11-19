import { Panel, PanelHeader } from '../ui/primitives';
import { formatDateTime, formatUsd } from '../../lib/utils';
import type { AIAnalysisRecord, BountyRecord, BountySnapshot, LeaderboardGapInsights } from '../../types/command-center';

interface Props {
  bounty: BountyRecord;
  snapshot: BountySnapshot | null;
  leaderboard: LeaderboardGapInsights | null;
  refreshError?: string | null;
  analysis: AIAnalysisRecord | null;
}

export function BountyResearchPanel({ bounty, snapshot, leaderboard, refreshError, analysis }: Props) {
  const deadline = Date.parse(bounty.deadline ?? '');
  const hoursLeft = (deadline - Date.now()) / 3_600_000;
  const open = bounty.acceptingSubmissions && !(hoursLeft <= 0);
  const payoutCurve = snapshot?.rawRequirements?.payout_curve as { places?: unknown } | undefined;
  const paidPlaces = Array.isArray(payoutCurve?.places) ? payoutCurve.places.length : null;
  const ranked = leaderboard?.totalRanked ?? null;
  const leader = leaderboard?.topEntries[0];
  const analysisMatches = Boolean(snapshot?.rulesHash && analysis?.evidence?.rulesHash === snapshot.rulesHash);
  const focusedStrategy = analysisMatches ? analysis?.differentiationStrategy : null;
  const observations = [
    ['Pengiriman', open ? 'Terbuka' : 'Tertutup'],
    ['Tenggat', bounty.deadline ? formatDateTime(bounty.deadline) : 'Belum tersedia'],
    ['Total hadiah', formatUsd(bounty.potUsd || bounty.rewardAmount)],
    ['Biaya masuk', bounty.entryFeeUsd == null ? 'Belum tersedia' : formatUsd(bounty.entryFeeUsd)],
    ['Entry tercatat', String(bounty.submissionCount)],
    ['Entry berperingkat', ranked == null ? 'Belum tersedia' : String(ranked)],
    ['Posisi berhadiah', paidPlaces == null ? 'Belum tersedia' : String(paidPlaces)],
  ];

  return (
    <Panel>
      <PanelHeader title="Riset Bounty & Peluang" subtitle={snapshot ? `Snapshot Make.fun · ${formatDateTime(snapshot.fetchedAt)}` : 'Snapshot detail belum tersedia'} />
      <div className="space-y-3 p-4 text-xs text-[#D1D5DB] sm:p-5">
        {(refreshError || bounty.syncState !== 'LIVE' || !snapshot?.requirementsComplete) && (
          <p role="status" className="text-[#FCD34D] break-words">{refreshError || 'Data riset belum terverifikasi lengkap. Gunakan Refresh Official untuk memeriksa ulang.'}</p>
        )}
        {bounty.summary && <p className="break-words">{bounty.summary}</p>}
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 md:grid-cols-4">
          {observations.map(([label, value]) => (
            <div key={label}>
              <dt className="text-[#9CA3AF]">{label}</dt>
              <dd className="mt-0.5 break-words font-medium text-[#F3F4F6] tabular-nums">{value}</dd>
            </div>
          ))}
        </dl>
        <div className="space-y-1 border-t border-white/10 pt-3">
          <h4 className="font-semibold text-[#F3F4F6]">Cara membaca peluang</h4>
          {!open ? <p>Bounty tercatat sudah menutup pengiriman. Gunakan hasil riset sebagai referensi.</p> : (
            <>
              {hoursLeft > 0 && hoursLeft < 24 && <p className="text-[#FCD34D]">Kurang dari 24 jam tersisa. Periksa apakah deliverable dan gate wajib masih bisa diselesaikan.</p>}
              {ranked != null && paidPlaces != null && <p>{ranked} entry berperingkat untuk {paidPlaces} posisi berhadiah pada snapshot ini. Jumlah tersebut mengukur persaingan yang terlihat. Peluang menang belum dapat dihitung dari angka ini.</p>}
              {leader && <p>Benchmark dari pemimpin leaderboard · {leaderboard.rankKeyTitle} {leader.primaryMetricValue}. Bandingkan entry kamu dengan metrik dan kriteria penilaian resmi.</p>}
              {ranked == null && <p>Data peringkat belum tersedia untuk menilai persaingan.</p>}
            </>
          )}
        </div>
        {focusedStrategy && <div className="space-y-1 border-t border-white/10 pt-3">
          <h4 className="font-semibold text-[#F3F4F6]">Pembeda dari analisis AI</h4>
          <p className="text-[#9CA3AF]">Analisis {formatDateTime(analysis?.createdAt)}</p>
          <p className="whitespace-pre-wrap break-words">{focusedStrategy}</p>
        </div>}
        <a href={bounty.url} target="_blank" rel="noopener noreferrer" className="inline-block font-medium text-[#93C5FD] underline underline-offset-2">Buka sumber resmi Make.fun</a>
      </div>
    </Panel>
  );
}
