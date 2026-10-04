declare namespace Rain {
  namespace ConfigFile {
    interface MyListInfoPart {
      type: 'playListPart_v2'
      data: Rain.List.MyDefaultListInfoFull | Rain.List.MyLoveListInfoFull | Rain.List.UserListInfoFull
    }

  }
}
