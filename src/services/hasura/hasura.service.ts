import { Injectable, HttpException, HttpStatus } from '@nestjs/common';
import axios from 'axios';
import { LoggerService } from 'src/services/logger/logger.service';


@Injectable()
export class HasuraService {
  private hasuraUrl = process.env.HASURA_URL;
  private adminSecretKey = process.env.HASURA_GRAPHQL_ADMIN_SECRET;
  private nameSpace = process.env.HASURA_NAMESPACE;

  constructor(private readonly logger: LoggerService) { }

  async getProviderList() {
    const query = `query GetUser {
    ${this.nameSpace}{User(where: {role: {_eq: "provider"}}) {
      id
      name
      email
      role
      approved
      enable
      reason
    }
  }
  }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Create Admin', HttpStatus.BAD_REQUEST);
    }
  }

  async getProviderInfoById(id) {
    const query = `query GetUser {
      ${this.nameSpace}{Provider(where: {user_id: {_eq: ${id}}}) {
        provideruserRelation {
          id
          name
          email
          mobile
          enable
          approved
          role
        }
        addressLine1
        addressLine2
        addressLine3
        organization
      }
    }
  }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Create Admin', HttpStatus.BAD_REQUEST);
    }
  }

  async getSeekerInfoById(id) {
    const query = `query GetUser {
      Seeker(where: {user_id: {_eq: ${id}}}) {
        addressLine1
        addressLine2
        addressLine3
        organization
        source_code
        user_id
        seekerUserRelation {
          id
          name
          mobile
          email
          role
          approved
          enable
        }
      }
  }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Create Admin', HttpStatus.BAD_REQUEST);
    }
  }

  async getSeekerList() {
    const query = `query GetUser {
      ${this.nameSpace}{User(where: {role: {_eq: "seeker"}}) {
      id
      name
      email
      role
      approved
      enable
      reason
    }
  }
  }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Create Admin', HttpStatus.BAD_REQUEST);
    }
  }

  async adminCreate(user) {
    const userMutation = `
      mutation ($name: String!, $password: String!, $role: String!,$email: String!,$approved:Boolean) {
        ${this.nameSpace}{insert_User(objects: {name:$name,password:$password,role:$role,email:$email,approved:$approved}) {
          returning {
            id,role
          }
        }
      }
      }
    `;

    try {
      const userResponse = await this.queryDb(userMutation, user);
      console.log("Admin response", userResponse);
      this.logger.log("Admin Created")
      return userResponse.data.insert_User.returning[0];
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Create Admin', HttpStatus.BAD_REQUEST);
    }
  }

  async createProviderUser(providerUser) {
    const query = `mutation InsertProvider($user_id: Int,$organization:String,$source_code:String) {
      ${this.nameSpace}{insert_Provider(objects: {user_id: $user_id, organization: $organization, source_code:$source_code}) {
        affected_rows
        returning {
          id
          user_id
          organization
          source_code
        }
      }
      }
    }`

    try {
      const response = await this.queryDb(query, providerUser)
      return response
    } catch (error) {
      throw new HttpException('Unabe to creatre Provider user', HttpStatus.BAD_REQUEST);
    }
  }

  async createSeekerUser(seeker) {
    const query = `mutation InsertSeeker($user_id: Int, $email: String , $name:String, $age:String, $gender:String, $phone:String) {
      ${this.nameSpace}{insert_Seeker(objects: {user_id: $user_id, email: $email, name: $name ,age: $age, gender: $gender, phone: $phone}) {
        affected_rows
        returning {
          id
          user_id
        }
      }
    }
    }`;

    console.log(query)

    // Rest of your code to execute the query

    try {
      const response = await this.queryDb(query, seeker)
      return response;
    } catch (error) {
      throw new HttpException('Unabe to creatre Seeker user', HttpStatus.BAD_REQUEST);
    }
  }

  async updateapprovalStatus(id, user) {
    const query = `mutation updateApprovalStatus($id: Int!, $approved: Boolean, $reason: String) {
      ${this.nameSpace}{update_User_by_pk(pk_columns: { id: $id }, _set: { approved: $approved, reason: $reason }) {
        id
        name
        approved
        reason
        enable
      }
    }
    }`;
    try {
      console.log("approval", user.approval)
      const response = await this.queryDb(query, { id: id, approved: user.approved, reason: user.reason })
      return response
    } catch (error) {
      throw new HttpException('Unable to approved User', HttpStatus.BAD_REQUEST);
    }
  }

  async updateEnableStatus(id, user) {
    const query = `mutation updateApprovalStatus($id: Int!, $enable: Boolean) {
      ${this.nameSpace}{update_User_by_pk(pk_columns: { id: $id }, _set: { enable: $enable}) {
        id
        name
        approved
        reason
        enable
      }
    }
    }`;
    try {
      console.log("user", user)
      const response = await this.queryDb(query, { id: id, enable: user.enable })
      return response
    } catch (error) {
      throw new HttpException('Unable to approved User', HttpStatus.BAD_REQUEST);
    }
  }

  async updatePassword(id, password) {
    console.log("id", id)
    console.log("password", password)
    const query = `mutation updateApprovalStatus($id: Int!, $password: String) {
      ${this.nameSpace}{update_User_by_pk(pk_columns: { id: $id }, _set: { password: $password}) {
        id
        name
        approved
        reason
        enable
      }
    }
    }`;
    try {

      const response = await this.queryDb(query, { id: id, password: password })
      return response
    } catch (error) {
      throw new HttpException('Unable to update password!', HttpStatus.BAD_REQUEST);
    }
  }

  async isUserApproved(email: string) {
    const query = `
      query IsUserApproved($email: String!) {
        ${this.nameSpace}{User(where: { email: { _eq: $email }, approved: { _eq: true } }) {
          id
        }
      }
      }
    `;
    try {
      const userResponse = await this.queryDb(query, { email });
      // this.logger.log("User Created")
      console.log("UserResponse", userResponse)
      return userResponse;
    } catch (error) {
      this.logger.error("User is Not Approved", error);
      throw new HttpException('User is Not approved', HttpStatus.BAD_REQUEST);
    }


  }

  async createUser(user) {
    console.log("user", user)
    console.log("nameSpace", this.nameSpace)
    const userMutation = `
      mutation ($name: String!, $password: String, $role: String!,$email: String!) {
        ${this.nameSpace}{insert_User(objects: { password: $password, role: $role, email: $email,name:$name}) {
          returning {
            id,role
          }
        }
      }
      }
    `;

    try {
      var userResponse = await this.queryDb(userMutation, user);
      this.logger.log("User Created")
      console.log("userResponse", userResponse)
      return userResponse.data.icar_.insert_User.returning[0];
    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException(userResponse, HttpStatus.BAD_REQUEST);
    }
  }

  async createUserSeeker(user) {
    console.log(user)
    const userMutation = `
      mutation ($name: String!,$email: String!) {
        ${this.nameSpace}{insert_Seeker_Details(objects: {  email: $email,name:$name}) {
          returning {
            id,role
          }
        }
      }
      }
    `;

    try {
      var userResponse = await this.queryDb(userMutation, user);
      this.logger.log("User Created")
      console.log("userResponse", userResponse)
      return userResponse.data.icar_.insert_User.returning[0];
    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException(userResponse, HttpStatus.BAD_REQUEST);
    }
  }

  async findOne(email: string): Promise<any> {
    console.log(email)
    const query = `
      query ($email: String!) {
        ${this.nameSpace}{User(where: {email: {_eq: $email}}) {
          id
          name
          email
          mobile
          password
          role
          approved
          enable
        }
      }
      }
    `;

    try {
      const response = await this.queryDb(query, {
        email,
      });
      console.log(response);
      return response.data.icar_.User[0] || null;
    } catch (error) {
      throw new HttpException('Failed to fetch user by username', HttpStatus.NOT_FOUND);
    }
  }

  async createContent(id, createContentdto) {
    // const query = `mutation InsertFlnContent($user_id:Int,$description: String,$code:String,$competency:String,$contentType:String,$domain:String,$goal:String,$image:String,$language:String,$link:String,$sourceOrganisation:String,$themes:String,$title:String, $content_id: String, $publisher: String, $collection: Boolean, $urlType: String, $mimeType: String, $minAge: Int, $maxAge: Int, $author: String, $learningOutcomes: String, $category: String ) {
    //   insert_fln_content(objects: {user_id:$user_id,description: $description,code: $code, competency:$competency, contentType:$contentType, domain:$domain, goal:$goal, image:$image, language:$language, link: $link, sourceOrganisation: $sourceOrganisation, themes: $themes, title: $title, content_id: $content_id, publisher: $publisher, collection: $collection, urlType: $urlType, mimeType: $mimeType, minAge: $minAge, maxAge: $maxAge, author: $author, learningOutcomes: $learningOutcomes, category: $category  }) {
    //     returning {
    //       id
    //       user_id
    //     }
    //   }
    // }
    const query = `mutation MyMutation(
      $user_id:Int,
      $content_id: String, 
      $branch: jsonb, 
      $contentType: String,  
      $crop: String, 
      $description: String, 
      $district: jsonb, 
      $expiryDate: String, 
      $fileType: String, 
      $monthOrSeason: String, 
      $publishDate: String, 
      $publisher: String, 
      $region: jsonb, 
      $target_users: jsonb,  
      $title: String, 
      $state: jsonb, 
      $url: String,
      $icon: String
      $language: String
      ){${this.nameSpace} {
        insert_Content(objects: {
        user_id:$user_id
        content_id: $content_id
        branch: $branch
        contentType: $contentType
        crop: $crop
        description: $description
        district: $district
        expiryDate: $expiryDate
        fileType: $fileType
        monthOrSeason: $monthOrSeason
        publishDate: $publishDate
        publisher: $publisher
        region: $region
        state: $state
        target_users: $target_users
        title: $title
        url: $url
        icon: $icon
        language: $language
      }) {
        affected_rows
        returning {
          id
          branch
          contentType
          content_id
          crop
          description
          district
          expiryDate
          fileType
          icon
          fileType
          monthOrSeason
          publishDate
          publisher
          region
          state
          target_users
          title
          url
          user_id
          language
        }
      }
      }
    }
    `

    try {
      console.log("Response ", createContentdto);
      const response = await this.queryDb(query, { user_id: id, ...createContentdto });
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create Content', HttpStatus.NOT_FOUND);
    }

  }

  async createContentBookmark(id, createContentdto) {
    const query = `mutation insert_bookmark_content($seeker_id:Int,$description: String,$code:String,$competency:String,$contentType:String,$domain:String,$goal:String,$image:String,$language:String,$link:String,$sourceOrganisation:String,$themes:String,$title:String) {
      insert_bookmark_content(objects: {seeker_id:$seeker_id,description: $description,code: $code, competency:$competency, contentType:$contentType, domain:$domain, goal:$goal, image:$image, language:$language, link: $link, sourceOrganisation: $sourceOrganisation, themes: $themes, title: $title}) {
        returning {
          id
          seeker_id
        }
      }
    }
    `
    try {
      console.log("Response ", createContentdto);
      const response = await this.queryDb(query, { seeker_id: id, ...createContentdto });
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create Content', HttpStatus.NOT_FOUND);
    }

  }

  async removeBookmarkContent(id, seeker_id) {
    console.log("id", id)
    console.log("seeker_id", seeker_id)
    const query = `mutation MyMutation {
      delete_bookmark_content(where: {id: {_eq: ${id}}, seeker_id: {_eq: ${seeker_id}}}) {
        returning {
          id
        }
      }
    }`
    try {
      const response = await this.queryDb(query);
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create Content', HttpStatus.NOT_FOUND);
    }

  }

  // async getBookmarkContent(seeker_id) {
  //   const query = `query GetUser {
  //     bookmark_content(where: {seeker_id: {_eq: ${seeker_id}}}) {
  //       code
  //       competency
  //       contentType
  //       description
  //       domain
  //       goal
  //       image
  //       language
  //       link
  //       sourceOrganisation
  //       themes
  //       title
  //       id
  //       seeker_id
  //     }
  // }`;
  //   try {
  //     const response = await this.queryDb(query);
  //     return response;
  //   } catch (error) {
  //     this.logger.error("Something Went wrong in creating Admin", error);
  //     throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
  //   }
  // }

  async getContent(id) {
    const query = `query GetUser {
      ${this.nameSpace}{Content(where: {user_id: {_eq: ${id}}}) {
        contentType
          content_id
          crop
          description
          expiryDate
          fileType
          icon
          id
          language
          monthOrSeason
          publishDate
          publisher
          region
          state
          target_users
          title
          url
          user_id
          branch
      }
    }
  }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async getContentById(id, provider_id) {
    //   const query = `query GetUser {
    //     fln_content(where: {id: {_eq: ${id}}, user_id: {_eq: ${provider_id}}}) {
    //       id
    //       user_id
    //       title
    //       themes
    //       url
    //       urlType
    //       sourceOrganisation
    //       publisher
    //       minAge
    //       mimeType
    //       maxAge
    //       link
    //       learningOutcomes
    //       language
    //       image
    //       goal
    //       domain
    //       description
    //       curricularGoals
    //       content_id
    //       contentType
    //       competency
    //       collection
    //       code
    //       author
    //       category
    //       createdAt
    //       updatedAt
    //     }
    // }`;
    const query = `query GetUser {
    ${this.nameSpace}{Content(where: {id: {_eq: ${id}}, user_id: {_eq: ${provider_id}}}) {
      contentType
        content_id
        crop
        description
        expiryDate
        fileType
        icon
        id
        language
        monthOrSeason
        publishDate
        publisher
        region
        state
        target_users
        title
        url
        user_id
        branch
    }
  }
}`
    try {
      console.log("query", query)
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async editContent(id, createContentdto) {
    console.log("id", id)
    console.log("createContentdto", createContentdto)

    const query = `mutation UpdateMyData(
      $id: Int!, 
      $branch: jsonb, 
      $contentType: String,  
      $crop: String, 
      $description: String, 
      $district: jsonb, 
      $expiryDate: String, 
      $fileType: String, 
      $monthOrSeason: String, 
      $publishDate: String, 
      $publisher: String, 
      $region: jsonb, 
      $target_users: jsonb,  
      $title: String, 
      $state: jsonb, 
      $url: String,
      $icon: String,
      $language: String
      ){${this.nameSpace} {
        update_Content(where: { id: { _eq: $id } }, _set: {
        branch: $branch
        contentType: $contentType
        crop: $crop
        description: $description
        district: $district
        expiryDate: $expiryDate
        fileType: $fileType
        monthOrSeason: $monthOrSeason
        publishDate: $publishDate
        publisher: $publisher
        region: $region
        state: $state
        target_users: $target_users
        title: $title
        url: $url
        icon: $icon
        language: $language
      }) {
        affected_rows
        returning {
          id
          branch
          contentType
          content_id
          crop
          description
          district
          expiryDate
          fileType
          icon
          fileType
          monthOrSeason
          publishDate
          publisher
          region
          state
          target_users
          title
          url
          user_id
          language
        }
      }
      }
    }
    `
    console.log("query", query)
    console.log("variables:", { id: id, ...createContentdto });
    try {
      const response = await this.queryDb(query, { id: id, ...createContentdto });
      console.log(response)
      return response;
    } catch (error) {
      throw new HttpException('Failed to Update Profile', HttpStatus.NOT_MODIFIED);
    }

  }

  async findContent1(getContentdto) {
    let result = 'where: {'
    let order = ''
    Object.entries(getContentdto).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
      if (key == 'orderBy') {
        console.log("554", `${key}: ${value}`);
        order = `order_by: {${value}: desc}`
      } else {
        console.log("557", `${key}: ${value}`);
        result += `${key}: {_eq: "${value}"}, `;
      }

    });
    result += '}'
    console.log("result", result)
    console.log("order", order)
    const query = `query MyQuery {
      fln_content(${order}, ${result}) {
        id
        code
        competency
        contentType
        description
        domain
        goal
        image
        language
        link
        sourceOrganisation
        themes
        title
        user_id
        content_id
        publisher
        collection
        urlType
        mimeType
        minAge
        maxAge
        author
        learningOutcomes
        category
        createdAt
        updatedAt
      }
      }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async findContent(searchQuery) {
    // let result = 'where: {'
    // Object.entries(getContentdto).forEach(([key, value]) => {
    //   console.log(`${key}: ${value}`);
    //   result += `${key}: {_eq: "${value}"}, `;
    // });
    // result += '}'
    // console.log("result", result)
    const query = `query MyQuery {
      fln_content(where: {_or: [{domain: {_iregex: "${searchQuery}"}}, {competency: {_iregex: "${searchQuery}"}}, {contentType: {_iregex: "${searchQuery}"}}, {description: {_iregex: "${searchQuery}"}}, {language: {_iregex: "${searchQuery}"}}, {sourceOrganisation: {_iregex: "${searchQuery}"}}, {title: {_iregex: "${searchQuery}"}}]}, order_by: {createdAt: desc}) {
        id
        code
        competency
            contentType
            description
        domain
        goal
        image
            language
        link
        sourceOrganisation
        themes
            title
            user_id
              content_id
            publisher
        collection
        urlType
        mimeType
        minAge
        maxAge
        author
        learningOutcomes
        category
        createdAt
        updatedAt
        }
      }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async findScholarshipContent(searchQuery) {
    // let result = 'where: {'
    // Object.entries(getContentdto).forEach(([key, value]) => {
    //   console.log(`${key}: ${value}`);
    //   result += `${key}: {_eq: "${value}"}, `;
    // });
    // result += '}'
    // console.log("result", result)
    console.log("searchQuery", searchQuery)
    const query = `query MyQuery {
      scholarship_content(where: {_or: [{domain: {_iregex: "${searchQuery}"}}, {name: {_iregex: "${searchQuery}"}}, {description: {_iregex: "${searchQuery}"}}, {provider: {_iregex: "${searchQuery}"}}, {creator: {_iregex: "${searchQuery}"}}, {category: {_iregex: "${searchQuery}"}}, {applicationDeadline: {_iregex: "${searchQuery}"}}]}) {
        id
        domain
        name
        description
        provider
        creator
        category
        applicationDeadline
        amount
        duration
        eligibilityCriteria
        applicationProcessing
        selectionCriteria
        noOfRecipients
        termsAndConditions
        additionalResources
        applicationForm
        applicationSubmissionDate
        contactInformation
        status
        keywords
        createdAt
        updatedAt
      }
      }`;
    try {
      const response = await this.queryDb(query);
      console.log("response", response)
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async deleteContent(id, provider_id) {
    console.log("provider_id", provider_id)
    console.log("id", id)
    const contentMutation = `mutation MyMutation { 
      ${this.nameSpace} {delete_Content(where: {id: {_eq: ${id}}, user_id: {_eq: ${provider_id}}}) {
        affected_rows
      }}
    }
    `;

    try {
      return await this.queryDb(contentMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting content", error);
      throw new HttpException("Something Went wrong in deleting content", HttpStatus.BAD_REQUEST);
    }
  }

  async findCollection(getCollectiondto) {
    let result = 'where: {'
    Object.entries(getCollectiondto).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
      result += `${key}: {_eq: "${value}"}, `;
    });
    result += '}'
    console.log("result", result)
    const query = `query MyQuery {
      collection(${result}) {
        id
        title
        icon
        domain
        description
        curricularGoals
        language
        learningObjectives
        maxAge
        minAge
        provider_id
        publisher
        themes
        createdAt
        updatedAt
      }
      }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async createCollection(provider_id, body) {
    console.log("provider_id", provider_id)
    console.log("body", body)
    const collectionMutation = `
    mutation MyMutation($provider_id:Int,) {
      ${this.nameSpace} {
        insert_${this.nameSpace}collection(objects: {
          provider_id: ${provider_id}, 
          title: "${body.title}",
          description: "${body.description}",
          icon: "${body.icon}",
          publisher: "${body.publisher}",
          author: "${body.author}",
          learningObjectives: "${body.learningObjectives}",
          language: "${body.language}",
          category: "${body.category}",
          themes: "${body.themes}",
          minAge: ${body.minAge},
          maxAge: ${body.maxAge},
          domain: "${body.domain}",
          curricularGoals: "${body.curricularGoals}",
        }) {
          returning {
            id
            provider_id
            title
            description
            icon
            publisher
            author
            learningObjectives
            category
            language
            themes
            minAge
            maxAge
            domain
            curricularGoals
            createdAt
            updatedAt
          }
        }
      }
    }
    `;

    try {
      console.log(collectionMutation)
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException("Something Went wrong in creating User", HttpStatus.BAD_REQUEST);
    }
  }

  async getCollection(provider_id) {
    console.log("provider_id", provider_id)
    const collectionMutation = `query MyQuery {
      ${this.nameSpace}{
        ${this.nameSpace}collection(where: {provider_id: {_eq: ${provider_id}}}) {
        id
        icon
        domain
        description
        curricularGoals
        language
        learningObjectives
        maxAge
        minAge
        publisher
        themes
        title
        category
        provider_id
        updatedAt
        createdAt
      }
    }
    }
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException("Something Went wrong in creating User", HttpStatus.BAD_REQUEST);
    }
  }

  async getAllCollection() {
    console.log("getAllCollection")
    const collectionMutation = `query MyQuery {
      ${this.nameSpace}{
        ${this.nameSpace}collection(where: {}) {
        id
        icon
        domain
        description
        curricularGoals
        language
        learningObjectives
        maxAge
        minAge
        publisher
        themes
        title
        provider_id
        createdAt
        updatedAt
      }
    }
    }
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException("Something Went wrong in creating User", HttpStatus.BAD_REQUEST);
    }
  }

  async getCollectionContent(id) {
    console.log("id", id)
    const collectionMutation = `query MyQuery {
      collection(where: {id: {_eq: ${id}}}) {
        id
        provider_id
        title
        icon
        domain
        description
        curricularGoals
        language
        learningObjectives
        maxAge
        minAge
        publisher
        themes
        category
        createdAt
        updatedAt
        collectionContentRelation {
          id
          content_id
          collection_id
          contentFlncontentRelation {
            id
            user_id
            title
            themes
            url
            urlType
            sourceOrganisation
            publisher
            minAge
            mimeType
            maxAge
            link
            learningOutcomes
            language
            image
            goal
            domain
            description
            curricularGoals
            content_id
            contentType
            competency
            collection
            code
            author
            category
            createdAt
            updatedAt
          }
        }
      }
    } 
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in fetching content list", error);
      throw new HttpException("Something Went wrong in content list", HttpStatus.BAD_REQUEST);
    }
  }


  async updateCollection(id, provider_id, body) {

    let updateSet = {};
    Object.keys(body).forEach((key) => {
      updateSet[key] = body[key];
    });



    const collectionMutation = `
  mutation MyMutation($provider_id: Int, $id: Int, $updateSet: ${this.nameSpace}collection_set_input) {
    ${this.nameSpace} {
      update_${this.nameSpace}collection(
        where: { id: { _eq: $id }, provider_id: { _eq: $provider_id } },
        _set: $updateSet
      ) {
        returning {
          id
          provider_id
          title
          description
          icon
          publisher
          author
          learningObjectives
          language
          category
          themes
          minAge
          maxAge
          domain
          curricularGoals
          createdAt
          updatedAt
        }
      }
    }
  }
`;

    try {
      console.log(collectionMutation);

      return await this.queryDb(collectionMutation, { provider_id, id, updateSet });

    } catch (error) {
      this.logger.error("Something Went wrong in updating Collection", error);
      throw new HttpException("Something Went wrong in updating Collection", HttpStatus.BAD_REQUEST);
    }


  }



  async deleteCollection(id, provider_id) {
    console.log("provider_id", provider_id)
    console.log("id", id)
    const collectionMutation = `mutation MyMutation {
      delete_collection(where: {id: {_eq: ${id}}, provider_id: {_eq: ${provider_id}}}) {
        affected_rows
      }
    }
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  async createContentCollection(body) {
    console.log("body", body)
    const collectionContentMutation = `mutation MyMutation {
      insert_contents(objects: {collection_id: ${body.collection_id}, content_id: ${body.content_id}}) {
        returning {
          collection_id
          content_id
          id
        }
      }
    }
    `;

    try {
      return await this.queryDb(collectionContentMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  async deleteContentCollection(id) {
    console.log("id", id)
    const collectionMutation = `mutation MyMutation {
      delete_contents(where: {id: {_eq: ${id}}}) {
        affected_rows
      }
    }
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  async queryDb(query: string, variables?: Record<string, any>): Promise<any> {
    try {
      const response = await axios.post(
        this.hasuraUrl,
        {
          query,
          variables,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            'x-hasura-admin-secret': this.adminSecretKey
          },
        }
      );
      console.log("response.data", response.data)
      return response.data;
    } catch (error) {
      console.log("error")
      return error;

    }
  }

  async createBulkContent(id, createContentdto) {
    let flnContentArray = [
      { author: "suraj k", code: "1234", collection: false, competency: "", contentType: "", content_id: "3211", curricularGoals: "", description: "", domain: "", goal: "", image: "", language: "", learningOutcomes: "xyz", link: "", maxAge: 10, mimeType: "", minAge: 20, publisher: "", sourceOrganisation: "", themes: "", title: "Physics", url: "", urlType: "", user_id: 35 },
      { author: "suraj s", code: "1245", collection: false, competency: "", contentType: "", content_id: "3221", curricularGoals: "", description: "", domain: "", goal: "", image: "", language: "", learningOutcomes: "xyz", link: "", maxAge: 10, mimeType: "", minAge: 20, publisher: "", sourceOrganisation: "", themes: "", title: "Maths", url: "", urlType: "", user_id: 35 }
    ]
    const query = `mutation MyMutation {
      insert_fln_content(objects: [
        {author: "suraj k", code: "123", collection: false, competency: "", contentType: "", content_id: "32146", curricularGoals: "", description: "", domain: "", goal: "", image: "", language: "", learningOutcomes: "xyz", link: "", maxAge: 10, mimeType: "", minAge: 20, publisher: "", sourceOrganisation: "", themes: "", title: "Physics", url: "", urlType: "", user_id: 35},
        {author: "suraj s", code: "124", collection: false, competency: "", contentType: "", content_id: "32236", curricularGoals: "", description: "", domain: "", goal: "", image: "", language: "", learningOutcomes: "xyz", link: "", maxAge: 10, mimeType: "", minAge: 20, publisher: "", sourceOrganisation: "", themes: "", title: "Maths", url: "", urlType: "", user_id: 35}
      ]) {
        affected_rows
        returning {
          id
          user_id
        }
      }
    }
    `
    try {

      const response = await this.queryDb(query);
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create Content', HttpStatus.NOT_FOUND);
    }

  }

  // seeker query
  async createBookmark(seeker_id, body) {
    console.log("seeker_id", seeker_id)
    console.log("body", body)
    const query = `mutation MyMutation {
        insert_bookmark(objects: {
          seeker_id: ${seeker_id}, 
          title: "${body.title}"
        }) {
          returning {
            id
            seeker_id
            title
            createdAt
            updatedAt
          }
        }
      }`;

    try {
      return await this.queryDb(query);

    } catch (error) {

      this.logger.error("Something Went wrong in creating Bookmark", error);
      throw new HttpException("Something Went wrong in creating Bookmark", HttpStatus.BAD_REQUEST);
    }
  }

  async getBookmark(seeker_id) {
    console.log("provider_id", seeker_id)
    const query = `query MyQuery {
      bookmark(where: {seeker_id: {_eq: ${seeker_id}}}) {
        id
        seeker_id
        title
        updatedAt
        createdAt
      }
    }
    `;

    try {
      return await this.queryDb(query);

    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException("Something Went wrong in creating User", HttpStatus.BAD_REQUEST);
    }
  }

  async getBookmarkContent(id, seeker_id) {
    console.log("id", id)
    const query = `query MyQuery {
      bookmark(where: {id: {_eq: ${id}}, seeker_id: {_eq: ${seeker_id}}}) {
        id
        seeker_id
        title
        createdAt
        updatedAt
        bookmarkContentRelation {
          id
          content_id
          bookmark_id
          createdAt
          updatedAt
          bookmarkContentFlnContentRelation {
            id
            user_id
            content_id
            title
            url
            urlType
            themes
            sourceOrganisation
            publisher
            minAge
            mimeType
            maxAge
            link
            learningOutcomes
            language
            image
            goal
            domain
            description
            curricularGoals
            contentType
            competency
            collection
            code
            author
            createdAt
            updatedAt
          }
        }
      }
    } 
    `;

    try {
      return await this.queryDb(query);

    } catch (error) {

      this.logger.error("Something Went wrong in fetching content list", error);
      throw new HttpException("Something Went wrong in content list", HttpStatus.BAD_REQUEST);
    }
  }

  async updateBookmark(id, seeker_id, body) {
    console.log("seeker_id", seeker_id)
    console.log("id", id)
    console.log("body", body)
    const query = `mutation MyMutation {
      update_bookmark(where: {id: {_eq: ${id}}, seeker_id: {_eq: ${seeker_id}}}, _set: {title: "${body.title}"}) {
        affected_rows
        returning {
          id
          seeker_id
          title
          updatedAt
          createdAt
        }
      }
    }
    `;

    try {
      return await this.queryDb(query);

    } catch (error) {

      this.logger.error("Something Went wrong in creating User", error);
      throw new HttpException("Something Went wrong in creating User", HttpStatus.BAD_REQUEST);
    }
  }

  async deleteBookmark(id, seeker_id) {
    console.log("seeker_id", seeker_id)
    console.log("id", id)
    const collectionMutation = `mutation MyMutation {
      delete_bookmark(where: {id: {_eq: ${id}}, seeker_id: {_eq: ${seeker_id}}}) {
        affected_rows
      }
    }
    `;

    try {
      return await this.queryDb(collectionMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  async addContentBookmark(body) {
    console.log("body", body)
    const collectionContentMutation = `mutation MyMutation {
      insert_bookmark_content(objects: {bookmark_id: ${body.bookmark_id}, content_id: ${body.content_id}}) {
        returning {
          id
          bookmark_id
          content_id
        }
      }
    }
    `;

    try {
      return await this.queryDb(collectionContentMutation);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  async deleteContentBookmark(id, seeker_id) {
    console.log("id", id)
    const query = `mutation MyMutation {
      delete_bookmark_content(where: {id: {_eq: ${id}}}) {
        affected_rows
      }
    }
    `;

    try {
      return await this.queryDb(query);

    } catch (error) {

      this.logger.error("Something Went wrong in deleting collection", error);
      throw new HttpException("Something Went wrong in deleting collection", HttpStatus.BAD_REQUEST);
    }
  }

  //scholarship
  async createScholarship(provider_id, scholarship) {
    const query = `mutation MyMutation(
        $provider_id: Int,
        $domain: String,
        $name: String,
        $description: String,
        $provider: String,
        $creator:String,
        $category:String,
        $applicationDeadline:String,
        $amount:Int,
        $duration:String,
        $eligibilityCriteria:String,
        $applicationProcessing:String, 
        $selectionCriteria: String, 
        $noOfRecipients: String, 
        $termsAndConditions: String, 
        $additionalResources: String, 
        $applicationForm: String, 
        $applicationSubmissionDate: String, 
        $contactInformation: String, 
        $status: String, 
        $keywords: String 
      ) {
      insert_scholarship_content(objects: {
        provider_id:$provider_id,
        domain: $domain,
        name: $name, 
        description: $description, 
        provider: $provider, 
        creator: $creator, 
        category: $category, 
        applicationDeadline: $applicationDeadline, 
        amount: $amount, 
        duration: $duration, 
        eligibilityCriteria: $eligibilityCriteria, 
        applicationProcessing: $applicationProcessing, 
        selectionCriteria: $selectionCriteria, 
        noOfRecipients: $noOfRecipients, 
        termsAndConditions: $termsAndConditions, 
        additionalResources: $additionalResources, 
        applicationForm: $applicationForm, 
        applicationSubmissionDate: $applicationSubmissionDate, 
        contactInformation: $contactInformation,
        status: $status, 
        keywords: $keywords  
      }) {
        returning {
          id
          provider_id
        }
      }
    }
    `
    try {
      console.log("scholarship ", scholarship);
      const response = await this.queryDb(query, { provider_id: provider_id, ...scholarship });
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create scholarship', HttpStatus.NOT_FOUND);
    }

  }

  async getScholarship(provider_id) {
    const query = `query MyQuery {
      scholarship_content(where: {provider_id: {_eq: ${provider_id}}}) {
        id
        name
        provider
        provider_id
        selectionCriteria
        status
        termsAndConditions
        keywords
        noOfRecipients
        eligibilityCriteria
        duration
        domain
        description
        creator
        contactInformation
        category
        applicationSubmissionDate
        applicationProcessing
        applicationForm
        applicationDeadline
        amount
        additionalResources
        createdAt
        updatedAt
      }
    }`
    try {
      const response = await this.queryDb(query)
      console.log("response", response)
      return response;
    } catch (error) {
      throw new HttpException('Unabe to create Seeker configuration', HttpStatus.BAD_REQUEST);
    }
  }

  async getScholarshipById(id, provider_id) {
    const query = `query MyQuery {
      scholarship_content(where: {provider_id: {_eq: ${provider_id}}, id: {_eq: ${id}}}) {
        id
        name
        provider
        provider_id
        selectionCriteria
        status
        termsAndConditions
        keywords
        noOfRecipients
        eligibilityCriteria
        duration
        domain
        description
        creator
        contactInformation
        category
        applicationSubmissionDate
        applicationProcessing
        applicationForm
        applicationDeadline
        amount
        additionalResources
        createdAt
        updatedAt
      }
    }`
    try {
      const response = await this.queryDb(query)
      console.log("response", response)
      return response;
    } catch (error) {
      throw new HttpException('Unabe to create Seeker configuration', HttpStatus.BAD_REQUEST);
    }
  }

  async editScholarshipById(id, provider_id, scholarship) {
    console.log("id", id)
    console.log("provider_id", provider_id)
    const query = `mutation MyMutation(
      $id: Int!,
      $provider_id: Int,
      $domain: String,
      $name: String,
      $description: String,
      $provider: String,
      $creator:String,
      $category:String,
      $applicationDeadline:String,
      $amount:Int,
      $duration:String,
      $eligibilityCriteria:String,
      $applicationProcessing:String, 
      $selectionCriteria: String, 
      $noOfRecipients: String, 
      $termsAndConditions: String, 
      $additionalResources: String, 
      $applicationForm: String, 
      $applicationSubmissionDate: String, 
      $contactInformation: String, 
      $status: String, 
      $keywords: String 
    ) {
      update_scholarship_content(where: {id: {_eq: $id}, provider_id: {_eq: $provider_id}},
        _set: {
      provider_id:$provider_id,
      domain: $domain,
      name: $name, 
      description: $description, 
      provider: $provider, 
      creator: $creator, 
      category: $category, 
      applicationDeadline: $applicationDeadline, 
      amount: $amount, 
      duration: $duration, 
      eligibilityCriteria: $eligibilityCriteria, 
      applicationProcessing: $applicationProcessing, 
      selectionCriteria: $selectionCriteria, 
      noOfRecipients: $noOfRecipients, 
      termsAndConditions: $termsAndConditions, 
      additionalResources: $additionalResources, 
      applicationForm: $applicationForm, 
      applicationSubmissionDate: $applicationSubmissionDate, 
      contactInformation: $contactInformation,
      status: $status, 
      keywords: $keywords  
    }) {
      returning {
        id
        provider_id
      }
    }
    }`
    try {
      console.log("scholarship ", scholarship);
      const response = await this.queryDb(query, { id: id, provider_id: provider_id, ...scholarship });
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create scholarship', HttpStatus.NOT_FOUND);
    }
  }

  async findScholarship(getContentdto) {
    let result = 'where: {'
    let order = ''
    Object.entries(getContentdto).forEach(([key, value]) => {
      console.log(`${key}: ${value}`);
      if (key == 'orderBy') {
        console.log("554", `${key}: ${value}`);
        order = `order_by: {${value}: desc}`
      } else {
        console.log("557", `${key}: ${value}`);
        result += `${key}: {_eq: "${value}"}, `;
      }

    });
    result += '}'
    console.log("result", result)
    console.log("order", order)
    const query = `query MyQuery {
      scholarship_content(${order}, ${result}) {
        id
        domain
        name
        description
        provider
        creator
        category
        applicationDeadline
        amount
        duration
        eligibilityCriteria
        applicationProcessing
        selectionCriteria
        noOfRecipients
        termsAndConditions
        additionalResources
        applicationForm
        applicationSubmissionDate
        contactInformation
        status
        keywords
        createdAt
        updatedAt
      }
      }`;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in finding scholarship data", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  //configuration

  async createConfig(user_id, body) {
    console.log("body", body)
    const query = `mutation MyMutation($user_id:Int!,$apiEndPoint:String,$bookmark:String,$displayOrder:json,$filterBy:String,$filters:json,$logo:String,$orderBy:String,$pagination:Int, $positionByLine: Boolean, $positionLogo: Boolean, $positionSiteName: Boolean, $rating: String, $share: String, $siteByLine: String, $siteName: String, $lableTitle: String, $lableAuthor: String, $lableDesc: String, $lableRating: String, $headerColor: String, $headerFontSize: String, $footerText: String) {
      update_Seeker(where: {user_id: {_eq: $user_id}}, _set: {apiEndPoint: $apiEndPoint, bookmark: $bookmark, displayOrder: $displayOrder, filterBy: $filterBy, filters: $filters, logo: $logo, orderBy: $orderBy, pagination: $pagination, positionByLine: $positionByLine, positionLogo: $positionLogo, positionSiteName: $positionSiteName, rating: $rating, share: $share, siteByLine: $siteByLine, siteName: $siteName, lableTitle: $lableTitle, lableAuthor: $lableAuthor, lableDesc: $lableDesc, lableRating: $lableRating, headerColor: $headerColor, headerFontSize: $headerFontSize, footerText: $footerText}) {
        affected_rows
        returning {
          id
          user_id
        }
      }
    }
    `
    try {
      const response = await this.queryDb(query, { user_id, ...body })
      console.log("response", response)
      return response;
    } catch (error) {
      throw new HttpException('Unabe to create Seeker configuration', HttpStatus.BAD_REQUEST);
    }
  }

  async getConfig(user_id) {
    const query = `query MyQuery {
      Seeker(where: {user_id: {_eq: ${user_id}}}) {
        id
        user_id
        apiEndPoint
        bookmark
        displayOrder
        filterBy
        filters
        logo
        orderBy
        pagination
        positionByLine
        positionLogo
        positionSiteName
        rating
        share
        siteByLine
        siteName
        lableTitle
        lableAuthor
        lableDesc
        lableRating
        headerColor
        headerFontSize
        footerText
        createdAt
        updatedAt
      }
    }
    
    `
    try {
      const response = await this.queryDb(query)
      console.log("response", response)
      return response;
    } catch (error) {
      throw new HttpException('Unabe to get Seeker configuration', HttpStatus.BAD_REQUEST);
    }
  }

  async createIcarContent(id, createIcarContentdto) {
    const query = `mutation InsertIcarContent($user_id:Int,$content_id: String,$title:String,$description:String,$icon:String,$publisher:String,$crop:String,$url:String,$state:jsonb,$district:jsonb,$region:jsonb,$language:String,$target_users:jsonb, $publishDate: String, $expiryDate: String, $branch: jsonb, $fileType: String, $contentType: String, $monthOrSeason: String ) {
      ${this.nameSpace}{insert_Content(objects: {user_id:$user_id,content_id: $content_id,title: $title, description:$description, icon:$icon, publisher:$publisher, crop:$crop, url:$url, state:$state, district: $district, region: $region, language: $language, target_users: $target_users, publishDate: $publishDate, expiryDate: $expiryDate, branch: $branch, fileType: $fileType, contentType: $contentType, monthOrSeason: $monthOrSeason}) {
        returning {
          id
          user_id
        }
      }
    }
  }
    `
    try {
      console.log("Response ", createIcarContentdto);
      const response = await this.queryDb(query, { user_id: id, ...createIcarContentdto });
      console.log("response", response);
      return response
    } catch (error) {
      throw new HttpException('Failed to create Content', HttpStatus.NOT_FOUND);
    }

  }


  async findIcarContent(searchQuery?: string) {
    const isProd = process.env.NODE_ENV === 'prod';
    console.log("isProd", isProd);
    let contentArgs = '';
    let gqlQuery = '';
    if (!searchQuery) {
      contentArgs = '(limit: 10)';
    } else {
      // Remove closing `)` and add limit
      contentArgs = searchQuery.replace(/\)\s*$/, '') + ', limit: 100)';
    }

    if (isProd) {
      gqlQuery = `query MyQuery {
        Content${contentArgs} {
          branch
          contentType
          content_id
          crop
          description
          district
          expiryDate
          fileType
          icon
          id
          language
          monthOrSeason
          publishDate
          publisher
          region
          state
          target_users
          title
          url
          user_id
          mimetype
          scheme_id
          ContentRatingRelationship {
            content_id
            id
            ratingValue
            user_id
            feedback
          }
          agri_domain
          scheme_intro
          scope
          scheme_benefits
          scheme_eligibility
          scheme_support
          scheme_misc
          scheme_application
          faq_url
        }
    }`;
    } else {
      gqlQuery = `query MyQuery {
        ${this.nameSpace} {
          Content${contentArgs} {
            branch
            contentType
            content_id
            crop
            description
            district
            expiryDate
            fileType
            icon
            id
            language
            monthOrSeason
            publishDate
            publisher
            region
            state
            target_users
            title
            url
            user_id
            mimetype
            scheme_id
            ContentRatingRelationship {
              content_id
              id
              ratingValue
              user_id
              feedback
            }
            agri_domain
            scheme_intro
            scope
            scheme_benefits
            scheme_eligibility
            scheme_support
            scheme_misc
            scheme_application
            faq_url
          }
        }
      }`;
    }

    // console.log("gqlQuery", gqlQuery);
    try {
      const response = await this.queryDb(gqlQuery);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async findIcarContentById(itemId) {
    console.log("searchQuery", itemId)
    const query = `query MyQuery {
      ${this.nameSpace} {
        Content(where: {id: {_eq: ${itemId}}}) {
          id
          branch
          contentType
          content_id
          crop
          description
          district
          expiryDate
          fileType
          icon
          language
          monthOrSeason
          publishDate
          publisher
          region
          state
          target_users
          title
          url
          user_id
        }
      }
    }
    `
      ;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async rateIcarContentById(content_id, ratingValue, feedback) {


    const query = `mutation MyMutation {
    ${this.nameSpace} {
    insert_Rating(objects: {content_id: "${content_id}", ratingValue: "${ratingValue}" , feedback: "${feedback}"}) {
        affected_rows
          returning {
            content_id
            id
            feedback
            ratingValue
            user_id
          }
        }
      }
    }`;
    console.log("query", query)
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }


  }

  async SubmitFeedback(description, id) {


    const query = `mutation MyMutation {
    ${this.nameSpace} {
    update_Rating(where: {id: {_eq: "${id}"}}, _set: {feedback: "${description}"}) {
      returning {
        feedback
        content_id
        id
        ratingValue
        user_id
      }
    }
  }
}`

      ;
    try {
      const response = await this.queryDb(query);
      return response;
    } catch (error) {
      this.logger.error("Something Went wrong in submittin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }


  }

  async IsUserExist(email) {
    const query = `query MyQuery {
    ${this.nameSpace} {
      Seeker(where: {email: {_eq: "${email}"}}) {
        id
        name
        phone
        email
      }
    }
  }
  `
      ;
    try {
      const response = await this.queryDb(query);
      if (response.data[`${this.nameSpace}`].Seeker[0] === undefined) {
        return false;
      } else { return true; }
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async FindUserByEmail(email) {
    const query = `query MyQuery {
    ${this.nameSpace} {
      Seeker(where: {email: {_eq: "${email}"}}) {
        id
        name
        phone
        email
        user_id
      }
    }
  }
  `
      ;
    try {
      const response = await this.queryDb(query);
      return response;

    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async GenerateOrderId(itemId, id, order_id) {
    const query = `mutation MyMutation {
    ${this.nameSpace} {
      insert_Order(objects: {content_id: "${itemId}", seeker_id: "${id}",order_id: "${order_id}" }) {
        returning {
          content_id
          id
          order_id
          seeker_id
        }
      }
    }
  }
  `
      ;
    try {
      const response = await this.queryDb(query);
      return response;

    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async IsOrderExist(itemId, id) {
    const query = `query MyQuery {
    ${this.nameSpace} {
      Order(where: {content_id: {_eq: "${itemId}"}, seeker_id: {_eq:"${id}"}}) {
        content_id
        id
        order_id
        seeker_id
      }
    }
  }
  `
      ;
    try {
      const response = await this.queryDb(query);
      if (response.data[`${this.nameSpace}`].Order[0] === undefined) {
        return false
      }
      else {
        return true;
      }

    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async GetOrderId(itemId, id) {
    const query = `query MyQuery {
    ${this.nameSpace} {
      Order(where: {content_id: {_eq: "${itemId}"}, seeker_id: {_eq:"${id}"}}) {
        content_id
        id
        order_id
        seeker_id
        order_id
      }
    }
  }
  `
      ;
    try {
      const response = await this.queryDb(query);
      return response

    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Unable to Fetch content!', HttpStatus.BAD_REQUEST);
    }
  }

  async getImageUrl(imageId: string): Promise<any> {
    try {
      const url = "http://localhost:3000/provider/getImageUrl/" + imageId;
      console.log(" image requst from >>", url);
      // const header = { headers: { 'Content-Type': 'application/json', 'x-hasura-admin-secret': '#z4X39Q!g1W7fDvX' } };
      const response = await axios.get(url);
      console.log("response.data", response.data)
      return response.data;
    } catch (error) {
      this.logger.error("Something Went wrong in creating Admin", error);
      throw new HttpException('Failed to Fetch image url!', HttpStatus.BAD_REQUEST);
    }
  }


}