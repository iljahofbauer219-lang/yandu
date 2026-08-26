const {ebayResearchQuerySuggestion}=require('./out/.tmp-ui-verify/verify-query-suggestion.js')

let failed=0
const eq=(name,got,want)=>{const ok=JSON.stringify(got)===JSON.stringify(want);console.log(`${ok?'PASS':'FAIL'} ${name}: ${JSON.stringify(got)}${ok?'':' 期望 '+JSON.stringify(want)}`);if(!ok)failed+=1}
const listing=(over)=>({id:'x',listingId:'x',storeId:'x',title:'',originalTitle:'',categoryId:'1',categoryName:'',condition:'New',marketplaceId:'EBAY_US',price:'',currency:'USD',imageUrl:'',imageUrls:[],viewUrl:'',updatedAt:'',...over})

// 1. 挂钟真实用例：剔 D32.3" 尺寸 + Grant 品牌，锚定 wall clock
eq('挂钟',ebayResearchQuerySuggestion(listing({
  originalTitle:'D32.3" Grant Oversized Wall Clock with Fir Wood Frame',
  itemSpecifics:[{name:'Brand',value:'Grant'}],
  categoryName:'Home & Garden > Home Décor > Clocks > Wall Clocks',
})),{query:'Oversized Wall Clock',source:'TITLE'})

// 2. itemSpecifics Type 在标题中：锚定 Type
eq('Type锚定',ebayResearchQuerySuggestion(listing({
  originalTitle:'Jersey Display Frame Case for Basketball Football',
  itemSpecifics:[{name:'Type',value:'Display Frame'}],
  categoryName:'Sporting Goods > Display Frames',
})),{query:'Jersey Display Frame',source:'PRODUCT_TYPE'})

// 3. 无属性：类目锚定 dresses→dress，前取两个修饰词
eq('连衣裙',ebayResearchQuerySuggestion(listing({
  originalTitle:"Women's Summer Dress Floral Print Casual",
  categoryName:'Clothing > Women > Dresses',
})),{query:"Women's Summer Dress",source:'TITLE'})

// 4. Type 不在标题中：标题前2词 + Type 拼接
eq('Type拼接',ebayResearchQuerySuggestion(listing({
  originalTitle:'Hasbro Marvel Spider-Man Legends 6in Figure',
  itemSpecifics:[{name:'Brand',value:'Hasbro'},{name:'Type',value:'Action Figure'}],
  categoryName:'Toys > Action Figures',
})),{query:'Marvel Spider-Man Action Figure',source:'PRODUCT_TYPE'})

// 5. 标题全部被过滤：类目兜底
eq('全过滤兜底',ebayResearchQuerySuggestion(listing({
  originalTitle:'New Hot Sale 2024',
  categoryName:'Wall Clocks',
})),{query:'Wall Clocks',source:'CATEGORY'})

// 6. Brand 无效值不剔除；容量单位剔除；类目复数归一锚定
eq('水瓶',ebayResearchQuerySuggestion(listing({
  originalTitle:'Acme Stainless Steel Water Bottle 500ml',
  itemSpecifics:[{name:'Brand',value:'Does not apply'}],
  categoryName:'Home > Kitchen > Water Bottles',
})),{query:'Stainless Steel Water Bottle',source:'TITLE'})

// 7. 3pcs/Set 剔除；knives→knife 匹配
eq('刀具',ebayResearchQuerySuggestion(listing({
  originalTitle:'3pcs Kitchen Knife Set Stainless Steel Chef Knives',
  categoryName:'Home > Kitchen > Kitchen Knives',
})),{query:'Kitchen Knife',source:'TITLE'})

// 8. 枕头真实用例：& 与 Multi-Functional 营销复合词剔除，锁定 bed pillow
eq('枕头',ebayResearchQuerySuggestion(listing({
  originalTitle:'Ergonomic Spinal Posture Support & Multi-Functional Bed Pillow -green',
  categoryName:'Home & Garden > Bedding > Bed Pillows',
})),{query:'Posture Support Bed Pillow',source:'TITLE'})

process.exit(failed?1:0)
