//Short People, excellente chanson de Randy Newman (https://play.google.com/music/preview/To5bpqly4uy6xpzie42hk2qeu2a?lyrics=1&utm_source=google&utm_medium=search&utm_campaign=lyrics&pcampaignid=kp-songlyrics)
	
var peopleSchema = new Schema({ 
	isari_authorized_centers : [{ 
		organization : { type : Schema.Type.ObjectId, ref : 'Organization' }, 
		isari_role : { 
			type : String, 
			enum : enums.isari_authorized_centers, 
		 }
	 }], 
	firstname : String, 
	name : { 
		type : String,
		required : true
	}, 
	gender : { 
		type : String, 
		enum : enums.genders, 
	 }, 
	birthdate : Date, 
	nationalities : [{ 
		type : String, 
		enum : enums.countries.nationality, 
	 }], 
	ldap_uid : String, 
	banner_uid : String, 
	SIRH_matricule : String, 
	ORCID : String, 
	IDREF : String, 
	SPIRE_ID : String, 
	positions : [{ 
			organization : { type : Schema.Type.ObjectId, ref : 'Organization' }, 
			start_date : Date, 
			end_date : Date, 
			timepart : { type : Number, default : 1 , min:0.05, max:1}, 						
			job_title : { 
				type : String, 
				enum : enums.job_title
			 }, 
			statuses : [{ 
					type : String, 
					enum : enums.statuses, 
					start_date : Date, 
					end_date : Date
			}],
			bonuses : [{ 
				bonusType : { 
					type : String, 
					enum : enums.bonuses
				 }, 
				start_date : Date, 
				end_date : Date
		 	}]
	}], 
	contacts : [{
		title : String,
		email : { type : String, match:/^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/}, 
		phone : { type : String}
	 }], 
	//photo_filename : String, 
	biography : String, 
	tags : { 
		hceres_2017 : [{ 
			type : String, 
			enum : enums.hceres_2017
		 }],  
		hceres_2012 : [{ 
			type : String, 
			enum : enums.hceres_2012
		 }],  
		methods : [{ 
			type : String, 
			enum : enums.methods
		 }], 
		free : Array, 
		erc : [{ 
			type : String, 
			enum : enums.erc
		 }],  
		discipline : { 
			type : String, 
			enum : enum.disciplines
		 }, 
		research_theme : { 
			type : String, 
			enum : enums.research_themes
		 }
	 },
	langs:[{
		type:String,
		enum:enums.iso6391
	}],
	personnal_activities : [
	 	{
	 		personnalActivityType:{
	 			type:String,
	 			validate: {
		          validator: function(v) {
		          	//check if value if an element of this tree : enums.personnalActivityTypes
		          	// maybe this field will not be validated in which cas the enum will only be used by autocompletion
		            return true;
		          }
		      }
	 		},
	 		start_date : Date,
	 		end_date : Date,
	 		role: String,
	 		description: String,
	 		organizations : [{ type : Schema.Type.ObjectId, ref : 'Organization' }]
	 	}
	 	// eneignemenet et encadrement demandent plus de champs... on les sépare ?
	], 
	distinctions : [{
		organizations : [{ type : Schema.Type.ObjectId, ref : 'Organization' }], 
		date : Date, 
		title : String, 
		distinctionType : { 
			type : String, 
			enum : enums.distinctionTypes
		 }, 
		subject : String, 
		honours : String //désolé, honours est toujours au pluriel. Faut pas se laisser aller à la mauvaise aurtaugrafe non plus.
	 }], 
});




var organizationSchema = new Schema({ 
	name : { 
		type : String,
		required : true
	}, 
	acronym : String,
	address : String,
	country : { 
		type : String, 
		enum : enums.countries.en_short_name
	 }, 
	status : {
		type : String,
		enum : enums.organizationStatuses
	},
	organizationType : {
		type : String,
		enum : enums.organizationTypes
	},
	url : String, // match syntax url ? allez non.
	organisation_links : [
		 {
			organization : { type : Schema.Type.ObjectId, ref : 'Organization' },
			description: String
		}
	] 
});




var activitySchema = new Schema({
	name : { 
		type : String,
		required : true
	}, 
	activityType : {
		type : String,
		enum : enums.activityTypes
	},
	start_date : Date, 
	end_date : Date,
	organizations : [{
		organization : { type : Schema.Type.ObjectId, ref : 'Organization' }, 
		role : {
			type : String,
			enum : enums.activityOrganizationRoles
		}
	}],
	people : [{
		people : { type : Schema.Type.ObjectId, ref : 'People' }, 		
		role : {
			type : String,
			enum : enums.activityPeopleRoles
		},
		start_date : Date,
		end_date : Date
	}],
	subject : String,
	summary : String,
	url : String, 
	grants : [
		{
			organization : { type : Schema.Type.ObjectId, ref : 'Organization' },
			name : String,
			grantType : {
				type : String,
				enum : enums.grantTypes
			},
			grant_identifier : String,
			sciencespo_amount : Number,
			total_amount : Number,
			currency_amount : {
				type : String,
				enum : enums.iso4217 
			}
			submission_date : Date,
			start_date : Date,
			end_date : Date,
			UG : String,
			status : {
				type : String,
				enum : enums.grantStatuses
			}
		}
	],
});

var Organization  = mongoose.model('Organization', organizationSchema);
var Activity  = mongoose.model('Activity', activitySchema);
var People  = mongoose.model('People', peopleSchema);