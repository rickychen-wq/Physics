/* 官方政府行政機關辦公日曆的「例外日」資料。
 * 只列平日放假或週末補班；一般週末與一般平日由 shared.js 自動判斷。
 * 來源：行政院人事行政總處／政府資料開放平臺，資料集 14718。
 */
window.TPS_TW_CALENDAR = {
  sourceName: '行政院人事行政總處',
  sourceUrl: 'https://data.gov.tw/dataset/14718',
  years: {
    '2026': [
      { date:'2026-01-01', type:'holiday', label:'開國紀念日' },
      { date:'2026-02-16', type:'holiday', label:'農曆除夕' },
      { date:'2026-02-17', type:'holiday', label:'春節' },
      { date:'2026-02-18', type:'holiday', label:'春節' },
      { date:'2026-02-19', type:'holiday', label:'春節' },
      { date:'2026-02-20', type:'holiday', label:'補假' },
      { date:'2026-02-27', type:'holiday', label:'補假' },
      { date:'2026-04-03', type:'holiday', label:'補假' },
      { date:'2026-04-06', type:'holiday', label:'補假' },
      { date:'2026-05-01', type:'holiday', label:'勞動節' },
      { date:'2026-06-19', type:'holiday', label:'端午節' },
      { date:'2026-09-25', type:'holiday', label:'中秋節' },
      { date:'2026-09-28', type:'holiday', label:'孔子誕辰紀念日／教師節' },
      { date:'2026-10-09', type:'holiday', label:'補假' },
      { date:'2026-10-26', type:'holiday', label:'補假' },
      { date:'2026-12-25', type:'holiday', label:'行憲紀念日' }
    ],
    '2027': [
      { date:'2027-01-01', type:'holiday', label:'開國紀念日' },
      { date:'2027-02-04', type:'holiday', label:'小年夜' },
      { date:'2027-02-05', type:'holiday', label:'農曆除夕' },
      { date:'2027-02-08', type:'holiday', label:'春節' },
      { date:'2027-02-09', type:'holiday', label:'補假' },
      { date:'2027-02-10', type:'holiday', label:'補假' },
      { date:'2027-03-01', type:'holiday', label:'補假' },
      { date:'2027-04-05', type:'holiday', label:'清明節' },
      { date:'2027-04-06', type:'holiday', label:'補假' },
      { date:'2027-04-30', type:'holiday', label:'補假' },
      { date:'2027-06-09', type:'holiday', label:'端午節' },
      { date:'2027-09-15', type:'holiday', label:'中秋節' },
      { date:'2027-09-28', type:'holiday', label:'孔子誕辰紀念日／教師節' },
      { date:'2027-10-11', type:'holiday', label:'補假' },
      { date:'2027-10-25', type:'holiday', label:'臺灣光復暨金門古寧頭大捷紀念日' },
      { date:'2027-12-24', type:'holiday', label:'補假' },
      { date:'2027-12-31', type:'holiday', label:'補假' }
    ]
  }
};
