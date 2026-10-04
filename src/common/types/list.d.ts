declare namespace Rain {
  namespace List {
    interface UserListInfo {
      id: string
      name: string
      // list: Rain.Music.MusicInfo[]
      source?: Rain.OnlineSource
      sourceListId?: string
      // position?: number
      locationUpdateTime: number | null
    }

    interface MyDefaultListInfo {
      id: 'default'
      name: 'list__name_default'
      // name: '试听列表'
      // list: Rain.Music.MusicInfo[]
    }

    interface MyLoveListInfo {
      id: 'love'
      name: 'list__name_love'
      // name: '我的收藏'
      // list: Rain.Music.MusicInfo[]
    }

    interface MyTempListInfo {
      id: 'temp'
      name: '临时列表'
      // list: Rain.Music.MusicInfo[]
      // TODO: save default lists info
      meta: {
        id?: string
      }
    }

    type MyListInfo = MyDefaultListInfo | MyLoveListInfo | UserListInfo

    interface MyAllList {
      defaultList: MyDefaultListInfo
      loveList: MyLoveListInfo
      userList: UserListInfo[]
      tempList: MyTempListInfo
    }


    type SearchHistoryList = string[]
    type ListPositionInfo = Record<string, number>
    type ListUpdateInfo = Record<string, {
      updateTime: number
      isAutoUpdate: boolean
    }>

    type ListSaveType = 'myList' | 'downloadList'
    type ListSaveInfo = {
      type: 'myList'
      data: Partial<MyAllList>
    } | {
      type: 'downloadList'
      data: Rain.Download.ListItem[]
    }


    type ListActionDataOverwrite = MakeOptional<Rain.List.ListDataFull, 'tempList'>
    interface ListActionAdd {
      position: number
      listInfos: UserListInfo[]
    }
    type ListActionRemove = string[]
    type ListActionUpdate = UserListInfo[]
    interface ListActionUpdatePosition {
      /**
       * 列表id
       */
      ids: string[]
      /**
       * 位置
       */
      position: number
    }

    interface ListActionMusicAdd {
      id: string
      musicInfos: Rain.Music.MusicInfo[]
      addMusicLocationType: Rain.AddMusicLocationType
    }

    interface ListActionMusicMove {
      fromId: string
      toId: string
      musicInfos: Rain.Music.MusicInfo[]
      addMusicLocationType: Rain.AddMusicLocationType
    }

    interface ListActionCheckMusicExistList {
      listId: string
      musicInfoId: string
    }

    interface ListActionMusicRemove {
      listId: string
      ids: string[]
    }

    type ListActionMusicUpdate = Array<{
      id: string
      musicInfo: Rain.Music.MusicInfo
    }>

    interface ListActionMusicUpdatePosition {
      listId: string
      position: number
      ids: string[]
    }

    interface ListActionMusicOverwrite {
      listId: string
      musicInfos: Rain.Music.MusicInfo[]
    }

    type ListActionMusicClear = string[]

    interface MyDefaultListInfoFull extends MyDefaultListInfo {
      list: Rain.Music.MusicInfo[]
    }
    interface MyLoveListInfoFull extends MyLoveListInfo {
      list: Rain.Music.MusicInfo[]
    }
    interface UserListInfoFull extends UserListInfo {
      list: Rain.Music.MusicInfo[]
    }
    interface MyTempListInfoFull extends MyTempListInfo {
      list: Rain.Music.MusicInfo[]
    }

    interface ListDataFull {
      defaultList: Rain.Music.MusicInfo[]
      loveList: Rain.Music.MusicInfo[]
      userList: UserListInfoFull[]
      tempList: Rain.Music.MusicInfo[]
    }
  }
}
