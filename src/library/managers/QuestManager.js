/* QuestManager.js
KC3改 Quest Management Object

Stand-alone object, attached to root window, never to be instantiated
Contains functions to perform quest management tasks
Uses KC3Quest objects to play around with
*/
(function(){
	"use strict";

	const MS_PER_HOUR = 1000 * 60 * 60;
	const MS_PER_DAY = MS_PER_HOUR * 24;

	const SUNDAY = 0;

	const JANUARY = 0;
	const FEBRUARY = 1;
	const MARCH = 2;
	const APRIL = 3;
	const MAY = 4;
	const JUNE = 5;
	const JULY = 6;
	const AUGUST = 7;
	const SEPTEMBER = 8;
	const OCTOBER = 9;
	const NOVEMBER = 10;
	const DECEMBER = 11;

	window.KC3QuestManager = {
		list: {}, // Use curly brace instead of square bracket to avoid using number-based indexes
		open: [], // Array of quests seen on the quests page, regardless of state
		active: [], // Array of quests that are active and counting

		// A quests list which confirmed sharing same counter at server-side
		// Currently quests list is confirmed at: http://wikiwiki.jp/kancolle/?%C7%A4%CC%B3#sc3afcc0
		sharedCounterQuests: [ [218, 212] ],

		/* GET
		Get a specific quest object in the list using its ID
		------------------------------------------*/
		get :function( questId ){
			// Return requested quest object of that ID, or a new Quest object, whichever works
			return (this.list["q"+questId] || (this.list["q"+questId] = new KC3Quest()));
		},

		exists :function( questId ){
			return !!this.list["q"+questId];
		},

		remove :function( quest ){
			var questId = (typeof quest === "object") ? quest.id : quest;
			return delete this.list["q"+questId];
		},

		/* GET ACTIVE
		Get list of active quests
		------------------------------------------*/
		getActives :function(){
			var activeQuestObjects = [];
			var self = this;
			$.each(this.active, function( index, element ){
				activeQuestObjects.push( self.get(element) );
			});
			return activeQuestObjects;
		},

		// Remove expired repeatables
		checkAndResetQuests: function (serverTime) {
			try {
				KC3QuestManager.load();

				KC3QuestManager.getRepeatableTypes().forEach(({ type, resetQuests }) => {
					const resetTime = KC3QuestManager.getResetTime(type, serverTime);
					if (serverTime >= resetTime) {
						resetQuests();
						KC3QuestManager.updateResetTime(type, serverTime);
						KC3QuestManager.triggerNetworkEvent();
					}
				});

				KC3QuestManager.save();
			} catch (error) {
				console.error("Reset Quest Error:", error);
			}
		},

		getResetTime: function (questType, serverTime) {
			const repeatable = KC3QuestManager.repeatableTypes[questType];

			const result = localStorage.getItem(repeatable.key);
			if (result) { return parseInt(result, 10); }

			const resetTime = repeatable.calculateNextReset(serverTime);
			localStorage.setItem(repeatable.key, resetTime);
			return resetTime;
		},

		updateResetTime: function (questType, serverTime) {
			const repeatable = KC3QuestManager.repeatableTypes[questType];

			localStorage.setItem(repeatable.key, repeatable.calculateNextReset(serverTime));
		},

		triggerNetworkEvent: function () {
			if (typeof KC3Network === 'object') {
				KC3Network.trigger('Quests');
			}
		},

		repeatableTypes: {
			daily: {
				type: 'daily',
				key: 'timeToResetDailyQuests',
				questIds: [201, 216, 210, 211, 218, 212, 226, 230, 303, 304, 402, 403, 503, 504, 605, 606, 607, 608, 609, 619, 702],
				resetQuests: function () { KC3QuestManager.resetDailies(); },
				calculateNextReset: function (serverTime) {
					// JST is +9 GMT, so 05:00 JST === 20:00 UTC
					let result = new Date(serverTime);

					if (result.getUTCHours() >= 20) {
						result = new Date(result.getTime() + MS_PER_DAY);
					}
					result.setUTCHours(20);
					result.setUTCMinutes(0);
					result.setUTCSeconds(0);
					result.setUTCMilliseconds(0);

					return result.getTime();
				},
			},
			weekly: {
				type: 'weekly',
				key: 'timeToResetWeeklyQuests',
				questIds: [214, 220, 213, 221, 228, 229, 241, 242, 243, 261, 302, 404, 410, 411, 613, 638, 703],
				resetQuests: function () { KC3QuestManager.resetWeeklies(); },
				calculateNextReset: function (serverTime) {
					const nextDailyReset = new Date(
						KC3QuestManager.repeatableTypes.daily.calculateNextReset(serverTime));
					const day = nextDailyReset.getUTCDay();

					// if the (daily) reset is on Sunday, it's also a weekly reset
					// (Monday 05:00 JST === Sunday 20:00 UTC)
					if (day === SUNDAY) {
						return nextDailyReset.getTime();
					}
					// otherwise we need to advance to the end of the week
					return nextDailyReset.getTime() + (MS_PER_DAY * (7 - day));
				},
			},
			monthly: {
				type: 'monthly',
				key: 'timeToResetMonthlyQuests',
				questIds: [249, 256, 257, 259, 265, 264, 266, 311, 424, 626, 628, 645],
				resetQuests: function () { KC3QuestManager.resetMonthlies(); },
				calculateNextReset: function (serverTime) {
					const nextDailyReset = new Date(
						KC3QuestManager.repeatableTypes.daily.calculateNextReset(serverTime));
					// Date will handle wrapping for us; e.g. Date(2016, 12) === Date(2017, 0)
					const firstDayOfNextMonth = new Date(Date.UTC(nextDailyReset.getUTCFullYear(),
						nextDailyReset.getUTCMonth() + 1));
					return firstDayOfNextMonth.getTime() - (4 * MS_PER_HOUR);
				},
			},
			quarterly: {
				type: 'quarterly',
				key: 'timeToResetQuarterlyQuests',
				questIds: [637, 643, 663, 822, 854],
				resetQuests: function () { KC3QuestManager.resetQuarterlies(); },
				calculateNextReset: function (serverTime) {
					const nextMonthlyReset = new Date(
						KC3QuestManager.repeatableTypes.monthly.calculateNextReset(serverTime));
					const month = nextMonthlyReset.getUTCMonth();
					switch (month) {
						// if nextMonthlyReset is in March, April, May, we're in the June quarter
						// (i.e. reset at May 31st, 20:00 UTC)
						case MARCH: case APRIL: case MAY: {
							const firstofJune = new Date(Date.UTC(nextMonthlyReset.getUTCFullYear(), JUNE));
							return firstofJune.getTime() - (4 * MS_PER_HOUR);
						}
						// if nextMonthlyReset is in June, July, August, we're in the September quarter
						// (i.e. reset at August 31st, 20:00 UTC)
						case JUNE: case JULY: case AUGUST: {
							const firstOfSeptember = new Date(Date.UTC(nextMonthlyReset.getUTCFullYear(), SEPTEMBER));
							return firstOfSeptember.getTime() - (4 * MS_PER_HOUR);
						}
						// if nextMonthlyReset is in September, October, November, we're in the December quarter
						// (i.e. reset at November 30th, 20:00 UTC)
						case SEPTEMBER: case OCTOBER: case NOVEMBER: {
							const firstOfDecember = new Date(Date.UTC(nextMonthlyReset.getUTCFullYear(), DECEMBER));
							return firstOfDecember.getTime() - (4 * MS_PER_HOUR);
						}
						// if nextMonthlyReset is in December, January, February, we're in the March quarter
						// (i.e. reset at February 28th/29th, 20:00 UTC)
						case DECEMBER: case JANUARY: case FEBRUARY: {
							const firstOfMarch = new Date(Date.UTC(nextMonthlyReset.getUTCFullYear(), MARCH));
							if (month === DECEMBER) {
								firstOfMarch.setUTCFullYear(nextMonthlyReset.getUTCFullYear() + 1);
							}
							return firstOfMarch.getTime() - (4 * MS_PER_HOUR);
						}
						default:
							// should be unreachable
							throw new Error(`Bad month: ${month}`);
					}
				},
			},
		},

		getRepeatableTypes: function () {
			return Object.keys(KC3QuestManager.repeatableTypes).map((key) => {
				return KC3QuestManager.repeatableTypes[key];
			});
		},

		// Get the ids of all quests of a specified repeatable type
		getRepeatableIds: function (type) {
			const repeatable = KC3QuestManager.repeatableTypes[type];

			return !!repeatable ? repeatable.questIds.concat() : [];
		},

		/* DEFINE PAGE
		When a user loads a quest page, we use its data to update our list
		------------------------------------------*/
		definePage :function( questList, questPage ){
			// For each element in quest List
			//console.log("=================PAGE " + questPage + "===================");
			var untranslated = [];
			var reportedQuests = JSON.parse(localStorage.reportedQuests||"[]");
			for(var ctr in questList){
				if(questList[ctr]===-1) continue;
				
				var questId = questList[ctr].api_no;
				var oldQuest = this.get( questId );
				oldQuest.defineRaw( questList[ctr] );
				oldQuest.autoAdjustCounter();
				
				// Check for untranslated quests
				if( typeof oldQuest.meta().available == "undefined" ){
					if(reportedQuests.indexOf(questId) === -1){
						untranslated.push(questList[ctr]);
						// remember reported quest so wont send data twice
						reportedQuests.push(questId);
					}
				}
				
				// Add to actives or opens depeding on status
				switch( questList[ctr].api_state ){
					case 1:	// Unselected
						this.isOpen( questList[ctr].api_no, true );
						this.isActive( questList[ctr].api_no, false );
						break;
					case 2:	// Selected
						this.isOpen( questList[ctr].api_no, true );
						this.isActive( questList[ctr].api_no, true );
						break;
					case 3:	// Completed
						this.isOpen( questList[ctr].api_no, false );
						this.isActive( questList[ctr].api_no, false );
						break;
					default:
						this.isOpen( questList[ctr].api_no, false );
						this.isActive( questList[ctr].api_no, false );
						break;
				}
			}
			
			// submit untranslated quests to kc3kai website
			if(ConfigManager.KC3DBSubmission_enabled){
				if(untranslated.length > 0){
					localStorage.reportedQuests = JSON.stringify(reportedQuests);
					KC3DBSubmission.sendQuests( JSON.stringify(untranslated) );
				}
			}
			
			this.save();
		},
		
		/* IS OPEN
		Defines a questId as open (not completed), adds to list
		------------------------------------------*/
		isOpen :function(questId, mode){
			if(mode){
				if(this.open.indexOf(questId) == -1){
					this.open.push(questId);
				}
			}else{
				if(this.open.indexOf(questId) > -1){
					this.open.splice(this.open.indexOf(questId), 1);
				}
			}
		},
		
		/* IS ACTIVE
		Defines a questId as active (the quest is selected), adds to list
		------------------------------------------*/
		isActive :function(questId, mode){
			if(mode){
				if(this.active.indexOf(questId) == -1){
					this.active.push(questId);
				}
			}else{
				if(this.active.indexOf(questId) > -1){
					this.active.splice(this.active.indexOf(questId), 1);
				}
			}
		},
		
		/* IS PERIOD
		Indicates if a questId is belong to time-period type quest.
		------------------------------------------*/
		isPeriod :function(questId){
			var period = this.getRepeatableIds('daily').indexOf(questId)>-1;
			period |= this.getRepeatableIds('weekly').indexOf(questId)>-1;
			period |= this.getRepeatableIds('monthly').indexOf(questId)>-1;
			period |= this.getRepeatableIds('quarterly').indexOf(questId)>-1;
			return !!period;
		},
		
		/* RESETTING FUNCTIONS
		Allows resetting quest state and counting
		------------------------------------------*/
		resetQuest :function(questId){
			if(typeof this.list["q"+questId] != "undefined"){
				delete this.list["q"+questId];
				this.isOpen(questId, false);
				this.isActive(questId, false);
			}
		},

		resetQuestCounter: function( questId ){
			if (typeof this.list["q"+questId] != "undefined"){
				this.list["q"+questId].tracking[0][0] = 0;
			}
		},
		
		resetLoop: function( questIds ){
			for(var ctr in questIds){
				this.resetQuest( questIds[ctr] );
			}
		},

		resetCounterLoop: function( questIds ){
			for(var ctr in questIds){
				this.resetQuestCounter( questIds[ctr] );
			}
		},
		
		resetDailies :function(){
			this.load();
			console.log("Resetting dailies");
			this.resetLoop(this.getRepeatableIds('daily'));
			this.resetCounterLoop([311]);
			this.save();
		},
		
		resetWeeklies :function(){
			this.load();
			console.log("Resetting weeklies");
			this.resetLoop(this.getRepeatableIds('weekly'));
			this.save();
		},
		
		resetMonthlies :function(){
			this.load();
			console.log("Resetting monthlies");
			this.resetLoop(this.getRepeatableIds('monthly'));
			this.save();
		},
		
		resetQuarterlies :function(){
			this.load();
			console.log("Resetting quarterlies");
			this.resetLoop(this.getRepeatableIds('quarterly'));
			this.save();
		},
		
		clear :function(){
			this.list = {};
			this.active = [];
			this.open = [];
			this.save();
		},
		
		/* SAVE
		Write current quest data to localStorage
		------------------------------------------*/
		save :function(){
			// Store only the list. The actives and opens will be redefined on load()
			localStorage.quests = JSON.stringify(this.list);
			
			// Check if synchronization is enabled and quests list is not empty
			ConfigManager.loadIfNecessary();
			if (ConfigManager.chromeSyncQuests && Object.keys(this.list).length > 0) {
				const now = Date.now();
				KC3QuestSync.save(Object.assign(KC3QuestManager.getRepeatableResetTimes(now), {
					quests: localStorage.quests,
					syncTimeStamp: now,
				}));
			}
		},

		getRepeatableResetTimes: function (timestamp) {
			return KC3QuestManager.getRepeatableTypes().reduce((result, { type, key }) => {
				result[key] = KC3QuestManager.getResetTime(type, timestamp);
				return result;
			}, {});
		},
		
		/* LOAD
		Read and refill list from localStorage
		------------------------------------------*/
		load :function(){
			if(typeof localStorage.quests != "undefined"){
				var tempQuests = JSON.parse(localStorage.quests);
				this.list = {};
				var tempQuest;
				
				// Empty actives and opens since they will be re-added
				this.active = [];
				this.open = [];
				
				for(var ctr in tempQuests){
					tempQuest = tempQuests[ctr];
					
					// Add to actives or opens depeding on status
					switch( tempQuest.status ){
						case 1:	// Unselected
							this.isOpen( tempQuest.id, true );
							this.isActive( tempQuest.id, false );
							break;
						case 2:	// Selected
							this.isOpen( tempQuest.id, true );
							this.isActive( tempQuest.id, true );
							break;
						case 3:	// Completed
							this.isOpen( tempQuest.id, false );
							this.isActive( tempQuest.id, false );
							break;
						default:
							this.isOpen( tempQuest.id, false );
							this.isActive( tempQuest.id, false );
							break;
					}
					
					// Add to manager's main list using Quest object
					this.list["q"+tempQuest.id] = new KC3Quest();
					this.list["q"+tempQuest.id].define( tempQuest );
				}
				// console.info("Quest management data loaded");
				return true;
			}
			return false;
		},

		mergeSyncData: function (remoteData) {
			var localQuests = KC3QuestManager.removeExpiredRepeatables(KC3QuestManager.getLocalData());
			var remoteQuests = KC3QuestManager.removeExpiredRepeatables(remoteData);

			var quests = KC3QuestManager.mergeQuests(remoteQuests, localQuests);

			KC3QuestManager.saveToLocal(quests, remoteData);
		},

		getLocalData: function () {
			return $.extend(KC3QuestManager.getRepeatableResetTimes(Date.now()), {
				quests: localStorage.quests || JSON.stringify({}),
			});
		},

		// Discard data for repeatable quests that have passed their reset time
		removeExpiredRepeatables: function (data) {
			var now = Date.now();
			return KC3QuestManager.getRepeatableTypes().reduce(function (quests, { key, type }) {
				var resetTime = parseInt(data[key], 10) || -1;
				if (now >= resetTime) {
					return KC3QuestManager.removeQuests(quests, KC3QuestManager.getRepeatableIds(type));
				}
				return quests;
			}, JSON.parse(data.quests));
		},

		removeQuests: function (quests, ids) {
			return ids.reduce(function (result, id) {
				result["q" + id] = null;
				return result;
			}, quests);
		},

		mergeQuests: function (remoteQuests, localQuests) {
			var ids = KC3QuestManager.getIdList(remoteQuests, localQuests);
			return ids.reduce(function (result, id) {
				var newState = KC3QuestManager.mergeQuestState(remoteQuests[id], localQuests[id]);
				if (newState) { result[id] = newState; }
				return result;
			}, {});
		},

		getIdList: function (remoteQuests, localQuests) {
			return Object.keys(localQuests).reduce(function (result, id) {
				if (!remoteQuests[id]) {
					result.push(id);
				}
				return result;
			}, Object.keys(remoteQuests));
		},

		mergeQuestState: function (remote, local) {
			if (!remote) { return local; }
			if (!local) { return remote; }

			if (remote.status === 3 && local.status !== 3) { return remote; }
			if (local.status === 3 && remote.status !== 3) { return local; }

			var result = KC3QuestManager.compareTrackingState(remote, local);
			if (result) { return result; }

			if (remote.progress || local.progress) {
				return (remote.progress || 0) > (local.progress || 0) ? remote : local;
			}

			return local;
		},

		compareTrackingState: function (remote, local) {
			var isRemoteValid = KC3QuestManager.isTrackingValid(remote);
			var isLocalValid = KC3QuestManager.isTrackingValid(local);

			if (isRemoteValid && !isLocalValid) { return remote; }
			if (isLocalValid && !isRemoteValid) { return local; }
			if (!isRemoteValid && !isLocalValid) { return null; }

			return KC3QuestManager.mergeTracking(remote, local);
		},

		// Check if the tracking property is defined correctly
		isTrackingValid: function (quest) {
			var meta = KC3Meta.quest(quest.id);
			if (!Array.isArray(quest.tracking) || !meta ||  !Array.isArray(meta.tracking)) {
				return false;
			}
			if (quest.tracking.length !== meta.tracking.length) {
				return false;
			}
			return quest.tracking.every(function (actual, index) {
				if (!actual || !Array.isArray(actual)) { return false; }
				var expected = meta.tracking[index];
				if (!expected || !Array.isArray(expected)) { return false; }
				return actual.length === expected.length;
			});
		},

		mergeTracking: function (remote, local) {
			// since validation passed, we know the two tracking arrays have the same length
			if (remote.tracking.length === 1) {
				return KC3QuestManager.selectSingleStageTracking(remote, local);
			} else if (remote.tracking.length >= 1) {
				return KC3QuestManager.mergeMultiStageTracking(remote, local);
			}
			// should be unreachable
			throw new Error('bad tracking array');
		},

		// Select the version with the higher progress
		selectSingleStageTracking: function (remote, local) {
			if (remote.tracking[0][0] > local.tracking[0][0]) {
				return remote;
			}
			return local;
		},

		// Combine versions for quests with multi-stage tracking (e.g. Bw1)
		mergeMultiStageTracking: function (remote, local) {
			// NB: result.progress may be incorrect
			// (shouldn't matter since multi-stage quests aren't auto-adjusted)
			return remote.tracking.reduce(function (result, stage, index) {
				result.tracking[index][0] = Math.max(stage[0], result.tracking[index][0]);
				return result;
			}, local);
		},

		saveToLocal: function (quests) {
			localStorage.quests = JSON.stringify(quests);

			KC3QuestManager.getRepeatableTypes().forEach(function ({ key }) {
				localStorage.removeItem(key);
			});
		},

		logError: function (e) {
			console.error(e);
		},
	};
	
})();
