declare namespace Rain {

  namespace Sync {
    namespace List {
      interface ListInfo {
        lastSyncDate?: number
        snapshotKey: string
      }

      type ActionList = Rain.Sync.SyncAction<'list_data_overwrite', Rain.List.ListActionDataOverwrite>
      | SyncAction<'list_create', Rain.List.ListActionAdd>
      | SyncAction<'list_remove', Rain.List.ListActionRemove>
      | SyncAction<'list_update', Rain.List.ListActionUpdate>
      | SyncAction<'list_update_position', Rain.List.ListActionUpdatePosition>
      | SyncAction<'list_music_add', Rain.List.ListActionMusicAdd>
      | SyncAction<'list_music_move', Rain.List.ListActionMusicMove>
      | SyncAction<'list_music_remove', Rain.List.ListActionMusicRemove>
      | SyncAction<'list_music_update', Rain.List.ListActionMusicUpdate>
      | SyncAction<'list_music_update_position', Rain.List.ListActionMusicUpdatePosition>
      | SyncAction<'list_music_overwrite', Rain.List.ListActionMusicOverwrite>
      | SyncAction<'list_music_clear', Rain.List.ListActionMusicClear>

      type ListData = Omit<Rain.List.ListDataFull, 'tempList'>
      type SyncMode = 'merge_local_remote'
      | 'merge_remote_local'
      | 'overwrite_local_remote'
      | 'overwrite_remote_local'
      | 'overwrite_local_remote_full'
      | 'overwrite_remote_local_full'
      // | 'none'
      | 'cancel'
    }
  }
}
