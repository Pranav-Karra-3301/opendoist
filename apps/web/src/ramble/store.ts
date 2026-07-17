/** Phase 7 FROZEN ramble UI store (plan Task A Step 9). */
import { create } from 'zustand'

interface RambleUiState {
  /** ramble currently recording/uploading/being reviewed; null = closed */
  activeRambleId: string | null
  reviewOpen: boolean
  openReview: (id: string) => void
  setActive: (id: string | null) => void
  closeReview: () => void
}

export const useRambleStore = create<RambleUiState>((set) => ({
  activeRambleId: null,
  reviewOpen: false,
  openReview: (id) => set({ activeRambleId: id, reviewOpen: true }),
  setActive: (id) => set({ activeRambleId: id }),
  closeReview: () => set({ reviewOpen: false, activeRambleId: null }),
}))
