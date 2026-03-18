import { HttpService } from "@nestjs/axios";
import {
  HttpException,
  HttpStatus,
  Injectable,
  InternalServerErrorException,
} from "@nestjs/common";
import { lastValueFrom, map } from "rxjs";
import { components } from "types/schema";
import { SwayamApiResponse } from "types/SwayamApiResponse";
import {
  selectItemMapper,
  scholarshipCatalogGenerator,
  IcarCatalogGenerator,
  flnCatalogGenerator,
  PmKisanIcarGenerator,
  pmfbyPolicyGenerator,
  pmfbyClaimStatusGenerator,
} from "utils/generator";
import { v4 as uuidv4 } from "uuid";
import { ConfigService } from "@nestjs/config";
import axios from "axios";
import {
  encrypt,
  decrypt,
  getUniqueKey,
  decryptRequest,
} from "./utils/encryption";
import { LoggerService } from "./services/logger/logger.service";
import { format } from "date-fns";

// getting course data
import * as fs from "fs";
import { HasuraService } from "./services/hasura/hasura.service";
import { AuthService } from "./auth/auth.service";
import { PmfbyService } from "./services/pmfby/pmfby.service";
import { WeatherForecastService } from "./services/weatherforecast/weatherforecast.service";
import { MandiService } from "./services/mandi/mandi.service";
const file = fs.readFileSync("./course.json", "utf8");
const courseData = JSON.parse(file);

// PM Kisan Portal Errors
const PMKissanProtalErrors = {
  "Income Tax Payee": {
    text: "{{farmer_name}}, you are an Income Tax Payee. Please contact your nearest CSC center for further assistance.",
    types: ["status", "payment", "installment"],
  },
  "Land Seeding, KYS": {
    text: "{{farmer_name}}, your land is under seeding/KYS process. Please wait for completion.",
    types: ["status", "payment", "installment"],
  },
  "No Errors": {
    text: "{{farmer_name}}, your {{latest_installment_paid}} installment has been processed successfully. Registration date: {{Reg_Date (DD-MM-YYYY)}}",
    types: ["status", "payment", "installment"],
  },
};

@Injectable()
export class AppService {

  constructor(
    private readonly httpService: HttpService,
    private readonly hasuraService: HasuraService,
    private readonly authService: AuthService,
    private readonly logger: LoggerService,
    private readonly configService: ConfigService,
    private readonly pmfbyService: PmfbyService,
    private readonly weatherForecastService: WeatherForecastService,
    private readonly mandiService: MandiService
  ) { }

  private nameSpace = process.env.HASURA_NAMESPACE;
  private base_url = process.env.BASE_URL;
  private namespace = process.env.NAMESPACE;

  private otpStore: Map<string, { otp: string; timestamp: number }> = new Map();
  private readonly OTP_VALIDITY_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

  private tempOTPStore = {
    otp: null,
    identifier: null,
    mobileNumber: null,
    timestamp: null,
  };

  /** For PMFBY init OTP flow: transaction_id -> phone (so we verify only when same transaction_id is sent back with OTP) */
  private pmfbyOtpTransactionStore: Map<string, string> = new Map();
  /** Transaction IDs that have completed OTP verification; search flow is allowed only for these */
  private pmfbyVerifiedTransactions: Set<string> = new Set();

  // 5 minutes in milliseconds
  private readonly OTP_EXPIRY_TIME = 5 * 60 * 1000;

  getHello(): string {
    return "Icar-network Backend is running!!";
  }

  async getCoursesFromFln(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    console.log("body 98", JSON.stringify(body));
    const intent: any = body.message.intent;
    console.log("intent: ", intent);

    // destructuring the intent
    const provider = intent?.provider?.descriptor?.name;
    const query = intent?.item?.descriptor?.name
      ? intent.item.descriptor.name
      : "";
    const tagGroup = intent?.item?.tags;
    console.log("query: ", query);
    console.log("tag group: ", tagGroup);

    const flattenedTags: any = {};
    if (tagGroup) {
      (tagGroup[0].list as any[])?.forEach((tag) => {
        flattenedTags[tag.name] = tag.value;
      });
    }
    console.log("flattened tags: ", flattenedTags);
    const domain = flattenedTags?.domain !== "" ? flattenedTags?.domain : null;
    const theme = flattenedTags?.theme !== "" ? flattenedTags?.theme : null;
    const goal = flattenedTags?.goal !== "" ? flattenedTags?.goal : null;
    const competency =
      flattenedTags?.competency !== "" ? flattenedTags?.competency : null;
    const language =
      flattenedTags?.language !== "" ? flattenedTags?.language : null;
    const contentType =
      flattenedTags?.contentType !== "" ? flattenedTags?.contentType : null;

    let obj = {};
    if (flattenedTags.domain) {
      obj["domain"] = flattenedTags.domain;
    }
    if (flattenedTags?.theme) {
      obj["theme"] = flattenedTags?.theme;
    }
    if (flattenedTags?.goal) {
      obj["goal"] = flattenedTags?.goal;
    }
    if (flattenedTags?.competency) {
      obj["competency"] = flattenedTags?.competency;
    }
    if (flattenedTags?.language) {
      obj["language"] = flattenedTags?.language;
    }
    if (flattenedTags?.contentType) {
      obj["contentType"] = flattenedTags?.contentType;
    }

    console.log("filter obj", obj);
    console.log("217", body.context.domain);
    try {
      const resp = await this.hasuraService.findContent(query);
      const flnResponse: any = resp.data.fln_content;
      console.log("flnResponse", flnResponse);
      for (let item of flnResponse) {
        if (item.image) {
          if (!this.isValidUrl(item.image)) {
            item.image = await this.hasuraService.getImageUrl(item.image);
          }
        }

        if (item.flncontentProviderRelationshp.image) {
          if (!this.isValidUrl(item.flncontentProviderRelationshp.image)) {
            item.flncontentProviderRelationshp.image =
              await this.hasuraService.getImageUrl(
                item.flncontentProviderRelationshp.image
              );
          }
        }
      }
      // const promises = flnResponse.map(async (item) => {
      //   //console.log("item", item)
      //   if (item.image) {
      //     if (this.isValidUrl(item.image)) {
      //       return item
      //     } else {
      //       let imageUrl = await this.s3Service.getFileUrl(item.image)
      //       if (imageUrl) {
      //         item.image = `${imageUrl}`
      //         return item;
      //       } else {
      //         return item;
      //       }
      //     }
      //   }
      //   return item

      // })
      // let flnResponseUpdated = await Promise.all(promises)
      //return flnResponse
      const catalog = flnCatalogGenerator(flnResponse, query);
      body.context.action = "on_search";
      const courseData: any = {
        context: body.context,
        message: {
          catalog: catalog,
        },
      };
      // console.log("courseData", courseData)
      // console.log("courseData 158", JSON.stringify(courseData))
      return courseData;
    } catch (err) {
      console.log("err: ", err);
      throw new InternalServerErrorException(err);
    }
  }

  async handleSearch2(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    const intent: any = body.message.intent;

    // destructuring the intent
    const provider = intent?.provider?.descriptor?.name;
    const query = intent?.item?.descriptor?.name;
    const tagGroup = intent?.item?.tags;

    const flattenedTags: any = {};
    if (tagGroup) {
      (tagGroup[0].list as any[])?.forEach((tag) => {
        flattenedTags[tag.name] = tag.value;
      });
    }
    const domain = flattenedTags?.domain !== "" ? flattenedTags?.domain : null;
    const theme = flattenedTags?.theme !== "" ? flattenedTags?.theme : null;
    const goal = flattenedTags?.goal !== "" ? flattenedTags?.goal : null;
    const competency =
      flattenedTags?.competency !== "" ? flattenedTags?.competency : null;
    const language =
      flattenedTags?.language !== "" ? flattenedTags?.language : null;
    const contentType =
      flattenedTags?.contentType !== "" ? flattenedTags?.contentType : null;

    let obj = {};
    if (flattenedTags.domain) {
      obj["domain"] = flattenedTags.domain;
    }
    if (flattenedTags?.theme) {
      obj["theme"] = flattenedTags?.theme;
    }
    if (flattenedTags?.goal) {
      obj["goal"] = flattenedTags?.goal;
    }
    if (flattenedTags?.competency) {
      obj["competency"] = flattenedTags?.competency;
    }
    if (flattenedTags?.language) {
      obj["language"] = flattenedTags?.language;
    }
    if (flattenedTags?.contentType) {
      obj["contentType"] = flattenedTags?.contentType;
    }

    try {
      const resp = await this.hasuraService.findIcarContent(query);
      console.log("resp", JSON.stringify(resp.data, null, 2));
      const icarResponse: any = resp.data.Content;
      console.log("icarResponse", icarResponse.length);
      const catalog = IcarCatalogGenerator(icarResponse, query);
      body.context.action = "on_search";
      const courseData: any = {
        context: body.context,
        message: {
          catalog: catalog,
        },
      };
      return courseData;
    } catch (err) {
      throw new InternalServerErrorException(err);
    }
  }

  async handleSearch(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    const intent: any = body.message.intent;

    // destructuring the intent
    const provider = intent?.provider?.descriptor?.name;
    const query = intent?.item?.descriptor?.name;
    const tagGroup = intent?.item?.tags;
    const categoryCode = intent?.category?.descriptor?.code;
    const schemeCode = intent?.item?.descriptor?.name;
    const requestDomain = body.context.domain;

    const flattenedTags: any = {};
    if (tagGroup) {
      (tagGroup[0].list as any[])?.forEach((tag) => {
        flattenedTags[tag.name] = tag.value;
      });
    }
    const domain = flattenedTags?.domain !== "" ? flattenedTags?.domain : null;
    const theme = flattenedTags?.theme !== "" ? flattenedTags?.theme : null;
    const goal = flattenedTags?.goal !== "" ? flattenedTags?.goal : null;
    const competency =
      flattenedTags?.competency !== "" ? flattenedTags?.competency : null;
    const language =
      flattenedTags?.language !== "" ? flattenedTags?.language : null;
    const contentType =
      flattenedTags?.contentType !== "" ? flattenedTags?.contentType : null;

    let obj = {};
    if (flattenedTags.domain) {
      obj["domain"] = flattenedTags.domain;
    }
    if (flattenedTags?.theme) {
      obj["theme"] = flattenedTags?.theme;
    }
    if (flattenedTags?.goal) {
      obj["goal"] = flattenedTags?.goal;
    }
    if (flattenedTags?.competency) {
      obj["competency"] = flattenedTags?.competency;
    }
    if (flattenedTags?.language) {
      obj["language"] = flattenedTags?.language;
    }
    if (flattenedTags?.contentType) {
      obj["contentType"] = flattenedTags?.contentType;
    }

    try {
      // Construct the query string
      // Construct the query string
      let searchQuery = "";
      const filters = [];

      // Add category code filter if it's not empty
      if (categoryCode && categoryCode.trim() !== "") {
        filters.push(`usecase: {_ilike: "${categoryCode}"}`);
      }

      // Add scheme code filter if it's not empty
      if (schemeCode && schemeCode.trim() !== "") {
        filters.push(`scheme_id: {_ilike: "${schemeCode}"}`);
      }

      // Construct the where clause if any filters are present
      if (filters.length > 0) {
        searchQuery = `(where: { ${filters.join(", ")} }, `;
      } else {
        searchQuery = ""; // or handle case where no filters are applied
      }

      const resp = await this.hasuraService.findIcarContent(searchQuery);
      const icarResponse: any = resp.data.icar_.Content;
      for (let item of icarResponse) {
        if (item.icon) {
          if (!this.isValidUrl(item.icon)) {
            item.icon = await this.hasuraService.getImageUrl(item.icon);
          }
        }
      }
      // Use different catalog generator based on domain
      let catalog;
      catalog = IcarCatalogGenerator(icarResponse, query);

      body.context.action = "on_search";
      const courseData: any = {
        context: body.context,
        message: {
          catalog: catalog,
        },
      };
      return courseData;
    } catch (err) {
      throw new InternalServerErrorException(err.message, {
        cause: err,
      });
    }
  }

  async searchForIntentQuery(body) {
    // Default values
    const defaultQuery = "farming practices";
    const defaultLimit = 5;
    const defaultFilter = "type:document";
    const defaultSearchMethod = "HYBRID";
    const defaultHybridParams = {
      retrievalMethod: "disjunction",
      rankingMethod: "rrf",
      alpha: 0.5,
      rrfK: 60,
    };

    const query = body?.message?.intent?.item?.descriptor?.name || defaultQuery;

    let limit = defaultLimit;
    let filter = defaultFilter;
    let searchMethod = defaultSearchMethod;
    let hybridParams = { ...defaultHybridParams };

    const tags = body?.message?.intent?.item?.fulfillment?.tags || [];

    for (const tag of tags) {
      const code = tag.descriptor?.code;

      if (code === "searchParam") {
        for (const param of tag.list || []) {
          const paramCode = param.descriptor?.code;
          const value = param.value;

          if (paramCode === "limit" && !isNaN(parseInt(value))) {
            limit = parseInt(value);
          }

          if (paramCode === "filter_string") {
            filter = value;
          }

          if (paramCode === "search_method") {
            searchMethod = value.toUpperCase(); // normalize casing
          }
        }
      }

      if (code === "hybrid_parameters") {
        for (const param of tag.list || []) {
          const paramCode = param.descriptor?.code;
          const value = param.value;

          if (paramCode === "retrievalMethod") {
            hybridParams.retrievalMethod = value;
          }

          if (paramCode === "rankingMethod") {
            hybridParams.rankingMethod = value;
          }

          if (paramCode === "alpha" && !isNaN(parseFloat(value))) {
            hybridParams.alpha = parseFloat(value);
          }

          if (paramCode === "rrfK" && !isNaN(parseInt(value))) {
            hybridParams.rrfK = parseInt(value);
          }
        }
      }
    }

    const payload = {
      q: query,
      limit,
      filter,
      searchMethod,
      hybridParameters: hybridParams,
    };

    try {
      const response = await axios.post(
        "http://3.6.146.174:8882/indexes/oan-index/search",
        payload
      );

      body.context.action = "on_search";

      const mappedData = this.mapVectorDbData(body?.context, response.data);

      return mappedData;
    } catch (error) {
      console.error("Error making Axios request:", error.message);
      throw new Error("Failed to fetch data from the search endpoint");
    }
  }

  async mapVectorDbData(context, inputData) {
    return {
      context,
      message: {
        catalog: {
          descriptor: {
            name: inputData.query || "Farming Practices",
          },
          providers: [
            {
              id: "19a02a67-d2f0-4ea7-b7e1-b2cf4fa57f56",
              descriptor: {
                name: "Agri Acad",
                short_desc: "Agri Academic aggregator",
                images: [
                  {
                    url: "https://agri_acad.example.org/logo.png",
                  },
                ],
              },
              items: inputData.hits.map((hit) => ({
                id: hit.doc_id,
                descriptor: {
                  name: hit.name,
                  short_desc: hit.source,
                  long_desc: hit.text,
                },
                tags: [
                  {
                    descriptor: {
                      name: "Document Type",
                      code: "DOC_TYPE",
                    },
                    list: [
                      {
                        descriptor: {
                          name: "Type",
                          code: "TYPE",
                        },
                        value: hit.type,
                      },
                    ],
                  },
                  {
                    descriptor: {
                      name: "Source",
                      code: "SOURCE",
                    },
                    list: [
                      {
                        descriptor: {
                          name: "Source",
                          code: "SRC",
                        },
                        value: hit.source,
                      },
                    ],
                  },
                  {
                    descriptor: {
                      name: "Highlights",
                      code: "HIGHLIGHTS",
                    },
                    list: hit._highlights.map((highlight) => ({
                      descriptor: {
                        name: "Highlight Text",
                        code: "H_TEXT",
                      },
                      value: highlight.text,
                    })),
                  },
                ],
              })),
            },
          ],
        },
      },
    };
  }

  async handleSelect(selectDto: any) {
    // fine tune the order here

    // order['id'] = selectDto.context.transaction_id + Date.now();

    const itemId = selectDto.message.order.items[0].id;

    const courseData = await this.hasuraService.findIcarContentById(itemId);
    console.log("contentData", courseData.data.Content);

    delete courseData.data.Content[0].url;

    //return

    //const itemId = selectDto.message.order.items[0].id;
    //const order: any = selectItemMapper(courseData[itemId]);

    const order: any = selectItemMapper(courseData.data.Content[0]);

    // order?.items.map((item) => {
    //   item['descriptor']['long_desc'] = longDes;
    //   item['tags'] = [...item['tags'],]
    // });

    selectDto.message.order = order;
    selectDto.context.action = "on_select";
    const resp = selectDto;
    return resp;
  }

  async handleInit(initDto: any) {
    const data = {
      itemId: initDto.message.order.items[0].id,
      name: initDto.message.order.fulfillments[0].customer.person.name,
      age: initDto.message.order.fulfillments[0].customer.person.age,
      gender: initDto.message.order.fulfillments[0].customer.person.gender,
      email: initDto.message.order.fulfillments[0].customer.contact.email,
      phone: initDto.message.order.fulfillments[0].customer.contact.phone,
      role: "seeker",
    };

    const existinguser = await this.hasuraService.IsUserExist(data.email);

    if (existinguser === false) {
      const user = await this.authService.createUser(data);
    }

    initDto.context.action = "on_init";
    const resp = initDto;
    return resp;
  }

  async handleConfirm(confirmDto: any) {
    // fine tune the order here
    const itemId = confirmDto.message.order.items[0].id;
    // const email = confirmDto.message.order.fulfillments[0].customer.contact.email;
    // const order_id = uuidv4();

    // const seeker = await this.hasuraService.FindUserByEmail(email)
    // const id = seeker.data[`${this.nameSpace}`].Seeker[0].id;

    // const presentOrder = await this.hasuraService.IsOrderExist(itemId, id)
    // if (!presentOrder) {

    //   const Order = await this.hasuraService.GenerateOrderId(itemId, id, order_id)
    // }

    // const OrderDetails = await this.hasuraService.GetOrderId(itemId, id)
    // const orderId = OrderDetails.data[`${this.nameSpace}`].Order[0].order_id
    // console.log("orderId", orderId)

    const courseData = await this.hasuraService.findIcarContentById(itemId);
    const order: any = selectItemMapper(courseData.data.Content[0]);
    order["fulfillments"] = confirmDto.message.order.fulfillments;
    order["id"] = confirmDto.context.transaction_id + Date.now();
    //rder['id'] = orderId
    order["state"] = "COMPLETE";
    order["type"] = "DEFAULT";
    order["created_at"] = new Date(Date.now());
    order["updated_at"] = new Date(Date.now());
    confirmDto.context.action = "on_confirm";
    confirmDto.message.order = order;

    return confirmDto;
  }

  async handleConfirm2(confirmDto: any) {
    // fine tune the order here
    const itemId = confirmDto.message.order.items[0].id;
    const order: any = selectItemMapper(courseData[itemId]);
    order["fulfillments"] = confirmDto.message.order.fulfillments;
    order["id"] = confirmDto.context.transaction_id + Date.now();
    order["state"] = "COMPLETE";
    order["type"] = "DEFAULT";
    order["created_at"] = new Date(Date.now());
    order["updated_at"] = new Date(Date.now());
    confirmDto.message.order = order;
    // storing draft order in database
    const createOrderGQL = `mutation insertDraftOrder($order: dsep_orders_insert_input!) {
      insert_dsep_orders_one (
        object: $order
      ) {
        order_id
      }
    }`;

    await lastValueFrom(
      this.httpService
        .post(
          process.env.HASURA_URI,
          {
            query: createOrderGQL,
            variables: {
              order: {
                order_id: confirmDto.message.order.id,
                user_id:
                  confirmDto.message?.order?.fulfillments[0]?.customer?.person
                    ?.name,
                created_at: new Date(Date.now()),
                updated_at: new Date(Date.now()),
                status: confirmDto.message.order.state,
                order_details: confirmDto.message.order,
              },
            },
          },
          {
            headers: {
              "Content-Type": "application/json",
              "x-hasura-admin-secret": process.env.SECRET,
            },
          }
        )
        .pipe(map((item) => item.data))
    );

    confirmDto.message.order = order;

    // update order as confirmed in database
    const updateOrderGQL = `mutation updateDSEPOrder($order_id: String, $changes: dsep_orders_set_input) {
      update_dsep_orders (
        where: {order_id: {_eq: $order_id}},
        _set: $changes
      ) {
        affected_rows
        returning {
          order_id
          status
          order_details
        }
      }
    }`;

    try {
      const res = await lastValueFrom(
        this.httpService
          .post(
            process.env.HASURA_URI,
            {
              query: updateOrderGQL,
              variables: {
                order_id: order.id,
                changes: {
                  order_details: order,
                  status: order.state,
                },
              },
            },
            {
              headers: {
                "Content-Type": "application/json",
                "x-hasura-admin-secret": process.env.SECRET,
              },
            }
          )
          .pipe(map((item) => item.data))
      );
      console.log("res in test api update: ", res.data);

      confirmDto.message.order = order;
      confirmDto.context.action = "on_confirm";
      console.log("action: ", confirmDto.context.action);
      return confirmDto;
    } catch (err) {
      console.log("err: ", err);
      throw new InternalServerErrorException(err);
    }
  }

  async handleRating(ratingDto: any) {
    const itemId = ratingDto.message.ratings[0].id;
    const rating = ratingDto.message.ratings[0].value ?? null;
    const feedback = ratingDto.message.ratings[0].feedback ?? null;

    const courseData = await this.hasuraService.rateIcarContentById(
      itemId,
      rating,
      feedback
    );
    const id = courseData.data.insert_Rating.returning[0].id;

    ratingDto.context.action = "on_rating";
    ratingDto.message = {
      feedback_form: {
        form: {
          //url: `${this.base_url}/feedback/${id}`,
          url: `https://icar-api.tekdinext.com/feedback/${id}`,
          mime_type: "text/html",
        },
        required: false,
      },
    };
    const resp = ratingDto;
    return resp;
  }

  async sendOTP(mobileNumber: string, type: string): Promise<any> {
    try {
      // Auto-detect the type if not provided
      let detectedType = type;
      this.logger.log("detectedType: ", detectedType);
      this.logger.log("mobileNumber: ", mobileNumber);
      // if (detectedType=="") {
        if (/^[6-9]\d{9}$/.test(mobileNumber)) {
          detectedType = "Mobile";
        // } else if (mobileNumber.length == 14 && /^[6-9]\d{9}$/.test(mobileNumber.substring(0, 10))) {
        //   detectedType = "MobileAadhar";
        } else if (mobileNumber.length == 12 && /^\d+$/.test(mobileNumber)) {
          detectedType = "Aadhar";
        } else if (mobileNumber.length == 11) {
          detectedType = "Ben_id";
        } else {
          // Default to Ben_id if format doesn't match any known pattern
          detectedType = "Ben_id";
        }
      // }

      let key = getUniqueKey();
      // Create the request data as a JSON string
      let requestData = JSON.stringify({
        Types: detectedType,
        Values: mobileNumber,
        Token: process.env.PM_KISSAN_TOKEN,
      });

      console.log("Request data: ", requestData);

      // Encrypt the request data
      let encrypted_text = await encrypt(requestData, key);
      console.log("encrypted text without @: ", encrypted_text);

      // Format the request data as expected by PM Kisan service
      let data = {
        EncryptedRequest: encrypted_text + "@" + key,
      };

      console.log("(in sendOTP)the data in the data var is as: ", data);

      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: `${process.env.PM_KISAN_BASE_OTP_URL}/ChatbotOTP`,
        headers: {
          "Content-Type": "application/json",
        },
        data: data,
        timeout: 10000, // 10 second timeout
      };
      console.log(config);
      let response: any = await axios.request(config);
      console.log("sendOTP", response.status);

      if (response.status >= 200 && response.status < 300) {
        response = await response.data;

        // Extract the encrypted response and key
        const [encryptedResponse, responseKey] = (
          response.d.output || ""
        ).split("@");

        if (!encryptedResponse) {
          console.error("No encrypted response received");
          return {
            d: {
              output: {
                status: "False",
                Message: "Invalid response format",
              },
            },
          };
        }

        // Use the response key for decryption
        let decryptedData: any = await decryptRequest(
          encryptedResponse,
          responseKey || key
        );
        console.log("Response from decryptedData(sendOTP)", decryptedData);

        try {
          const parsedData = JSON.parse(decryptedData);
          response.d.output = parsedData;
          response["status"] =
            response.d.output.Rsponce !== "False" ? "OK" : "NOT_OK";
        } catch (e) {
          console.error("Error parsing decrypted data:", e);
          response["status"] = "NOT_OK";
        }

        return response;
      } else {
        return {
          d: {
            output: {
              status: "False",
              Message: "Try again",
            },
          },
        };
      }
    } catch (error) {
      console.error(
        "Error in sendOTP:",
        error.message,
        error.response?.data || error
      );

      /*
      // Check for network-related errors
      if (error.code === 'ECONNREFUSED' || 
          error.code === 'ENOTFOUND' || 
          error.code === 'ETIMEDOUT' ||
          error.code === 'ECONNABORTED' ||
          error.message.includes('Network Error') ||
          error.message.includes('timeout') ||
          error.message.includes('connect') ||
          error.message.includes('ENOTFOUND')) {
        console.log("Network connectivity issue detected - not sending OTP");
        return {
          d: {
            output: {
              status: "False",
              Message: "Network connectivity issue detected. Please check your internet connection and try again.",
            },
          },
        };
      }
      */
      return {
        d: {
          output: {
            status: "False",
            Message: "Try again",
          },
        },
      };
    }
  }

  async verifyOTP(
    mobileNumber: string,
    otp: string,
    type?: string
  ): Promise<any> {
    try {
      // Auto-detect the type if not provided
      let detectedType = type;
      // if (!detectedType) {
        // Comment out other cases and keep only Ben_id
        if (/^[6-9]\d{9}$/.test(mobileNumber)) {
          detectedType = "Mobile";
        // } else if (mobileNumber.length == 14 && /^[6-9]\d{9}$/.test(mobileNumber.substring(0, 10))) {
        //   detectedType = "MobileAadhar";
        } else if (mobileNumber.length == 12 && /^\d+$/.test(mobileNumber)) {
          detectedType = "Aadhar";
        } else if (mobileNumber.length == 11) {
          detectedType = "Ben_id";
        } else {
          // Default to Ben_id if format doesn't match any known pattern
          detectedType = "Ben_id";
        }

        // Always use Ben_id
        // detectedType = "Ben_id";
      // }

      console.log(
        `Detected type for verification ${mobileNumber}: ${detectedType}`
      );

      const requestData = JSON.stringify({
        Types: detectedType,
        Values: String(mobileNumber),
        OTP: String(otp),
        Token: String(process.env.PM_KISSAN_TOKEN),
      });
      console.log("Request data: ", requestData);
      let key = getUniqueKey();
      let encrypted_text = await encrypt(requestData, key); //without @

      console.log("encrypted text without @: ", encrypted_text);

      let data = {
        EncryptedRequest: `${encrypted_text}@${key}`,
      };
      console.log("(inside verifyOTP)the data in the data var is : ", JSON.stringify(data, null, 2));
      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: `${process.env.PM_KISAN_BASE_OTP_URL}/ChatbotOTPVerified`,
        headers: {
          "Content-Type": "application/json",
        },
        data: data,
      };

      let response: any = await axios.request(config);
      // console.log("verifyOTP", response.status);
      if (response.status >= 200 && response.status < 300) {
        response = await response.data;
        let decryptedData: any = await decryptRequest(response.d.output, key);
        // console.log("Response of VerifyOTP", response);
        console.log("Response from decryptedData(verifyOTP)", decryptedData);

        try {
          const parsedDecryptedData = JSON.parse(decryptedData);
          response.d.output = parsedDecryptedData;
          response["status"] =
            parsedDecryptedData.Rsponce === "True" ? "OK" : "NOT_OK";
        } catch (e) {
          console.error("Error parsing decrypted data:", e);
          response["status"] = "NOT_OK";
        }

        return response;
      } else {
        return {
          d: {
            output: {
              status: "False",
              Message: "Try again",
            },
          },
        };
      }
    } catch (error) {
      console.error("Error in verifyOTP:", error);
      return {
        d: {
          output: {
            status: "False",
            Message: "Try again",
          },
        },
      };
    }
  }

  async handleStatus(body: any) {
    // console.log("Input body:", JSON.stringify(body, null, 2));

    try {
      const orderId = body.message?.order_id;
      const regNumber = body.message?.registration_number;
      const phoneNumber = body.message?.phone_number;
      if (!orderId && !regNumber) {
        return this.createStatusErrorResponse(
          body.context,
          "missing_order_id_or_registration_number",
          "Please provide a valid order ID or registration number"
        );
      }

      // Check if this is an OTP validation request
      const isOtpValidation = /^\d{4,6}$/.test(orderId);
      if (isOtpValidation) {
        // PMFBY: verify OTP + get policy/claim status via /status
        if (this.isPmfbyStatusRequest(body)) {
          console.log("inside handleStatus: isPmfbyStatusRequest");
          return await this.handlePmfbyStatus(body, orderId);
        }
        console.log("inside handleStatus: PMKISAN otp validate and status request");
        return await this.handleOtpValidation(body, orderId, regNumber, phoneNumber);
      }

      // Handle other status requests if needed
      return this.createStatusErrorResponse(
        body.context,
        "invalid_request",
        "Invalid status request"
      );
    } catch (err) {
      console.error("❌ Error in handleStatus:", err);
      console.error("❌ Error message:", err.message);
      console.error("❌ Error stack:", err.stack);
      throw new InternalServerErrorException(err.message, { cause: err });
    }
  }

  async handleStatusForSHC(input: any, body: any): Promise<any> {
    // Log input for debugging (replace with proper logger in production)

    // Validate input and context parameters
    if (
      !input ||
      !input.data ||
      !Array.isArray(input.data.getTestForAuthUser) ||
      input.data.getTestForAuthUser.length === 0
    ) {
      throw new HttpException(
        "Invalid input: data.getTestForAuthUser must be a non-empty array",
        HttpStatus.BAD_REQUEST
      );
    }

    // Parameter mapping for standardized codes
    const parameterMapping: { [key: string]: string } = {
      pH: "ph",
      OC: "organic_carbon",
      OM: "organic_matter",
      p: "phosphorus",
      k: "potassium",
      S: "sulphur",
      Cu: "copper",
      Fe: "iron",
      Mn: "manganese",
      Zn: "zinc",
      EC: "soil_salinity",
      B: "boron",
    };

    // Conversion factor for bags to kilograms
    const BAG_TO_KG = 50;

    const items = input.data.getTestForAuthUser
      .map((data: any, index: number) => {
        // Validate data object
        if (!data) {
          console.warn(
            `Skipping invalid item at index ${index}: data is null or undefined`
          );
          return null;
        }

        // Validate required fields
        const requiredFields = [
          { key: "id", message: "Missing id or computedID" },
          { key: "reportData", message: "Missing reportData" },
          { key: "rdfValues", message: "Missing rdfValues" },
          {
            key: "reportData.parameterInfos",
            message: "Missing reportData.parameterInfos",
          },
          {
            key: "rdfValues.fertilizerRecommendation_details",
            message: "Missing rdfValues.fertilizerRecommendation_details",
          },
          {
            key: "rdfValues.deficiency",
            message: "Missing rdfValues.deficiency",
          },
        ];

        for (const field of requiredFields) {
          const keys = field.key.split(".");
          let current = data;
          for (const key of keys) {
            if (
              !current ||
              current[key] === undefined ||
              current[key] === null
            ) {
              console.warn(
                `${field.message} for item ${data.id || data.computedID || "unknown"
                } at index ${index}`
              );
              return null;
            }
            current = current[key];
          }
        }

        // Process crops with null check
        let crops: string[] = [];
        if (typeof data.crop === "string" && data.crop.trim()) {
          crops = data.crop
            .split(",")
            .map((crop: string) => crop.trim())
            .filter((crop: string) => crop);
        }
        const recommendedCrops =
          crops.length > 0 ? crops.join(", ") : "Unknown";

        // Map test parameters to tags, handling missing boron
        const parameterTags = data.reportData.parameterInfos
          .map((param: any) => {
            if (!param || !param.key || param.value === undefined) {
              console.warn(
                `Invalid parameter for item ${data.id || data.computedID || "unknown"
                }: missing key or value`
              );
              return null;
            }
            const value =
              param.value === "NA"
                ? "Not available"
                : `${param.value} ${param.unit || ""} (${param.rating || "Unknown"
                })`;
            return {
              code: parameterMapping[param.key] || param.key.toLowerCase(),
              value,
            };
          })
          .filter((tag: any) => tag !== null);

        // Add boron if in testparameters but missing in parameterInfos
        if (
          Array.isArray(data.testparameters) &&
          data.testparameters.includes("B") &&
          !data.reportData.parameterInfos.some((p: any) => p.key === "B")
        ) {
          parameterTags.push({
            code: "boron",
            value: "Not available",
          });
        }

        // Convert HTML to Base64 with null check
        const htmlContent = typeof data.html === "string" ? data.html : "";
        const base64Html = Buffer.from(htmlContent).toString("base64");

        // Map fertilizer recommendations with validation
        const fertilizerTags = (
          data.rdfValues.fertilizerRecommendation_details || []
        )
          .map((rec: any, recIndex: number) => {
            if (!rec || !rec.crop) {
              console.warn(
                `Skipping invalid fertilizer recommendation at index ${recIndex} for item ${data.id || data.computedID || "unknown"
                }: missing or invalid crop`
              );
              return null;
            }

            const mapFertilizers = (fertilizers: any[]) =>
              (fertilizers || [])
                .map((fert: any, fertIndex: number) => {
                  if (
                    !fert ||
                    !fert.fertilizer ||
                    !fert.fertilizer.name ||
                    !fert.bags
                  ) {
                    console.warn(
                      `Skipping invalid fertilizer at index ${fertIndex} for crop ${rec.crop
                      } in item ${data.id || data.computedID || "unknown"}`
                    );
                    return null;
                  }
                  const bags = parseFloat(fert.bags) || 0;
                  const quantityKg = (bags * BAG_TO_KG).toFixed(2);
                  return {
                    fertilizer: fert.fertilizer.name,
                    quantity: `${quantityKg} Kg per Acre`,
                    nutrients: {
                      n: (
                        (fert.fertilizer?.composition?.n || 0) *
                        parseFloat(quantityKg)
                      ).toFixed(2),
                      p: (
                        (fert.fertilizer?.composition?.p || 0) *
                        parseFloat(quantityKg)
                      ).toFixed(2),
                      k: (
                        (fert.fertilizer?.composition?.k || 0) *
                        parseFloat(quantityKg)
                      ).toFixed(2),
                    },
                  };
                })
                .filter((fert: any) => fert !== null);

            return {
              code: `fertilizer_recommendation_${rec.crop
                .replace(/[^a-zA-Z0-9]/g, "_")
                .toLowerCase()}`,
              value: JSON.stringify({
                crop: rec.crop,
                combOne: mapFertilizers(rec.combOne || []),
                combTwo: mapFertilizers(rec.combTwo || []),
                fym:
                  rec.fym && rec.Fymunit
                    ? `${rec.fym} ${rec.Fymunit}`
                    : "Not available",
              }),
            };
          })
          .filter((tag: any) => tag !== null);

        // Map deficiency data with validation
        const deficiencyTags = (data.rdfValues.deficiency || [])
          .map((def: any, index: number) => {
            if (!def) {
              console.warn(
                `Skipping invalid deficiency at index ${index} for item ${data.id || data.computedID || "unknown"
                }`
              );
              return null;
            }
            return {
              code: `deficiency_${index + 1}`,
              value: JSON.stringify({
                nutrients: {
                  n: `${def.n || 0} Kg per Acre`,
                  p: `${def.p || 0} Kg per Acre`,
                  k: `${def.k || 0} Kg per Acre`,
                  fym: `${def.fym || 0} Tonne per Acre`,
                },
                micronutrients: def.range
                  ? JSON.stringify(def.range)
                  : "Unknown",
                details: def.details || "No details provided",
              }),
            };
          })
          .filter((tag: any) => tag !== null);

        // Additional fulfillment tags with null checks
        const additionalFulfillmentTags = [
          { code: "report_format", value: "PDF, JSON" },
          { code: "language", value: "English, Hindi" },
          { code: "farmer_name", value: data.farmer?.name || "Unknown" },
          { code: "farmer_address", value: data.farmer?.address || "Unknown" },
          { code: "farmer_phone", value: data.farmer?.phone || "Unknown" },
          { code: "plot_area", value: `${data.plot?.area || 0} hectares` },
          { code: "plot_survey_no", value: data.plot?.surveyNo || "Unknown" },
          { code: "scheme_id", value: data.scheme?._id || "Unknown" },
          { code: "scheme_name", value: data.scheme?.name || "Unknown" },
          { code: "scheme_type", value: data.scheme?.type || "Unknown" },
          {
            code: "scheme_department",
            value: data.scheme?.department || "Unknown",
          },
          {
            code: "scheme_created_at",
            value: data.scheme?.createdAt || "Unknown",
          },
          { code: "district_id", value: data.district?._id || "Unknown" },
          { code: "district_name", value: data.district?.name || "Unknown" },
          { code: "block_id", value: data.block?._id || "Unknown" },
          { code: "block_name", value: data.block?.name || "Unknown" },
          { code: "village_id", value: data.village?._id || "Unknown" },
          { code: "village_name", value: data.village?.name || "Unknown" },
          { code: "village_status", value: data.village?.status || "Unknown" },
          { code: "sample_date", value: data.sampleDate || "Unknown" },
          {
            code: "test_completed_at",
            value: data.testCompletedAt || "Unknown",
          },
          {
            code: "location_coordinates",
            value: data.location?.coordinates?.join(", ") || "Unknown",
          },
          { code: "status", value: data.status || "Unknown" },
          {
            code: "test_parameters",
            value: (data.testparameters || []).join(", ") || "Unknown",
          },
          {
            code: "fym_list",
            value:
              (data.rdfValues.fymlist || [])
                .map((fym: any) => fym ?? 0)
                .join(", ") || "Unknown",
          },
          {
            code: "gypsum_list",
            value:
              (data.rdfValues.gypsumlist || [])
                .map((g: any) => g ?? 0)
                .join(", ") || "Unknown",
          },
          ...fertilizerTags,
          ...deficiencyTags,
        ];

        // Create a short description based on key nutrient ratings
        const nutrientRatings =
          data.reportData.parameterInfos
            .filter((param: any) =>
              ["pH", "EC", "OC", "p", "k"].includes(param.key)
            )
            .map(
              (param: any) =>
                `${param.name || param.key}: ${param.rating || "Unknown"}`
            )
            .join(", ") || "No nutrient ratings available";

        return {
          id: data.computedID || data.id || "unknown",
          descriptor: {
            name: `Soil Health Card for Farmer ${data.farmer?.name || "Unknown"
              }`,
            short_desc: `${nutrientRatings}, crop recommendation: ${recommendedCrops}`,
            long_desc: `Soil Health Card for ${data.farmer?.name || "Unknown"
              } in ${data.village?.name || "Unknown"}, ${data.district?.name || "Unknown"
              }. Nutrient Ratings: ${nutrientRatings}. Recommended crops: ${recommendedCrops}.`,
          },
          media: [
            {
              mimetype: "text/html",
              url: base64Html,
            },
          ],
          tags: [{ list: parameterTags }],
          fulfillments: [
            {
              id: data.computedID || data.id || "unknown",
              type: "digital",
              start: {
                time: {
                  timestamp: data.sampleDate || new Date().toISOString(),
                },
              },
              end: {
                time: {
                  timestamp: data.testCompletedAt || new Date().toISOString(),
                },
              },
              tags: additionalFulfillmentTags,
            },
          ],
        };
      })
      .filter((item: any) => item !== null);

    return {
      context: {
        domain: body?.context?.domain,
        location: { country: { name: "IND" } },
        action: "on_init",
        version: "1.1.0",
        bap_id: body?.context?.bap_id,
        bap_uri: body?.context?.bap_uri,
        transaction_id: body?.context?.transaction_id,
        message_id: body?.context?.message_id,
        timestamp: body?.context?.timestamp,
        ttl: "PT10M",
      },
      message: {
        order: {
          provider: {
            id: "471",
            descriptor: {
              name:
                input.data.getTestForAuthUser[0]?.scheme?.name ||
                "Soil Health Card Service",
              images: [
                { url: "https://soilhealth.dac.gov.in/files/report/shc.png" },
              ],
            },
          },
          providers: [
            {
              id:
                input.data.getTestForAuthUser[0]?.scheme?._id ||
                "unknown_provider",
              descriptor: {
                name:
                  input.data.getTestForAuthUser[0]?.scheme?.department ||
                  "Unknown Department",
                short_desc: "Govt Soil Testing Lab - Maharashtra, India",
                images: [
                  { url: "https://soilhealth.dac.gov.in/files/report/lab.png" },
                ],
              },
              items,
            },
          ],
        },
      },
    };
  }

  async fetchAndMapSoilHealthCard(body): Promise<any> {
    const baseUrl = process.env.SOIL_HEALTH_BASE_URL;

    // Step 1: Get access token
    const tokenPayload = {
      query:
        "query Query($refreshToken: String!) { generateAccessToken(refreshToken: $refreshToken) }",
      variables: {
        refreshToken:
          "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlblR5cGUiOiJSZWZyZXNoVG9rZW4iLCJhdXRob3JpdHkiOiIiLCJwYXJlbnQiOiIiLCJ0eXBlIjoiRXh0ZXJuYWxVc2VyIiwic3ViIjoiNjc3NzgwZWYzNzkyZjZmOWQxMzExOWJkIiwidXNlcnN0YXR1cyI6IkFDVElWRSIsImlhdCI6MTczNTg4NTAzOSwiZXhwIjoxNzM2NDg5ODM5LCJhdWQiOiJzb2lsaGVhbHRoLmRhYy5nb3YuaW4iLCJpc3MiOiJzb2lsaGVhbHRoLmRhYy5nb3YuaW4iLCJqdGkiOiI0NzEzNjg3ZS1hM2NmLTRiYTUtYjk0MC0wZjFlZDliZjE4YmEifQ.rOl0BztuPnmJh53hnzr9sv3Nfj4n1qTnABpOU-1N1KA",
      },
    };

    let accessToken: string;
    try {
      const tokenResponse = await axios.post(baseUrl, tokenPayload, {
        headers: {
          "Content-Type": "application/json",
        },
      });

      accessToken = tokenResponse.data?.data?.generateAccessToken?.token;
      console.log("accessToken--->>", accessToken);
      if (!accessToken) {
        throw new Error("Failed to retrieve access token");
      }
    } catch (error) {
      throw new HttpException(
        `Token retrieval failed: ${error.message}`,
        HttpStatus.UNAUTHORIZED
      );
    }

    // Helper function to extract tag value by code
    const getTagValue = (tags, code) => {
      const tag = tags?.find((t) => t.descriptor?.code === code);
      return tag?.value;
    };

    // Extract values from body
    const tags =
      body?.message?.order?.fulfillments?.[0]?.customer?.person?.tags;
    const phone =
      body?.message?.order?.fulfillments?.[0]?.customer?.contact?.phone;

    // Step 2: Call soil health API with the access token
    const soilHealthPayload = {
      query:
        "query GetTestForAuthUser($computedId: String, $phone: PhoneNumber, $state: String, $district: String, $name: String, $farmer: String, $from: Datetime, $to: Datetime, $cycle: String, $locale: String, $scheme: String, $limit: Int, $skip: Int) { getTestForAuthUser(computedID: $computedId, phone: $phone, state: $state, district: $district, name: $name, farmer: $farmer, from: $from, to: $to, cycle: $cycle, scheme: $scheme, limit: $limit, skip: $skip) { id computedID cycle scheme plot { address area surveyNo } farmer { address name phone } crop location testparameters rdfValues status testCompletedAt sampleDate reportData district block village results fertilizer html(locale: $locale) uniqueID } }",
      variables: {
        cycle: getTagValue(tags, "cycle"),
        phone: phone,
        limit: 10,
        skip: 0,
        locale: "en", // Add locale if required by the API; adjust as needed
      },
    };

    console.log(
      "soilHealthPayload-->>",
      JSON.stringify(soilHealthPayload, null, 2)
    );
    console.log("baseUrl----> ", baseUrl);
    try {
      const soilHealthResponse = await axios.post(baseUrl, soilHealthPayload, {
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${accessToken}`,
        },
      });
      console.log("api response ----> ", soilHealthResponse.data);
      const soilHealthData = soilHealthResponse.data;
      if (!soilHealthData?.data?.getTestForAuthUser) {
        throw new Error("No soil health data found");
      }

      return soilHealthData;
    } catch (error) {
      console.error(
        "Soil health API error:",
        error.response?.data || error.message
      );
      throw new HttpException(
        `Soil health API call failed: ${error.message}`,
        error.response?.status || HttpStatus.INTERNAL_SERVER_ERROR
      );
    }
  }

  private async handleOtpValidation(body: any, orderId: string, regNumber: string, phoneNumber: string) {
    try {
      // const storedData = this.tempOTPStore;

      // if (!storedData?.mobileNumber) {
      //   return this.createStatusErrorResponse(
      //     body.context,
      //     "invalid_otp",
      //     "The OTP you entered is either incorrect, expired, or already used. Please request a new OTP and try again."
      //   );
      // }


      // TODO: comment for now implement OTP later
      // Verify OTP
      const verifyResponse = await this.verifyOTP(
        regNumber,
        orderId
      );

      if (verifyResponse.status !== "OK") {
        return this.createStatusErrorResponse(
          body.context,
          "invalid_otp",
          "Invalid or expired OTP. Please try again."
        );
      }

      // console.log("✅ OTP validation successful!");
      console.log("✅ OTP IS SKIPPED!");
      // Clear OTP after successful validation
      // this.clearTempOTPStore();

      // Fetch user data after successful OTP verification
      try {
        // const context = {
        //   userAadhaarNumber: storedData.identifier || storedData.mobileNumber,
        //   lastAadhaarDigits: "",
        //   queryType: "status",
        // };

        const context = {
          userAadhaarNumber: regNumber || phoneNumber || "",
          lastAadhaarDigits: "",
          queryType: "status",
        };

        const userDataResponse = await this.fetchUserData(context, {});
        return this.createSuccessResponse(
          body.context,
          orderId,
          regNumber,
          userDataResponse
        );
      } catch (fetchError) {
        console.error("❌ Error in fetchUserData:", fetchError);
        return this.createFetchErrorResponse(
          body.context,
          orderId,
          regNumber,
          fetchError
        );
      }
    } catch (error) {
      console.error("❌ Error in OTP validation:", error);
      return this.createStatusErrorResponse(
        body.context,
        "otp_validation_failed",
        "Failed to validate OTP. Please try again."
      );
    }
  }

  /** Returns true if the status request is for PMFBY (schemes-agri / pmfby provider and item). */
  private isPmfbyStatusRequest(body: any): boolean {
    const providerId = body?.message?.order?.provider?.id ?? "";
    const itemId = body?.message?.order?.items?.[0]?.id ?? "";
    const pid = String(providerId).toLowerCase();
    const iid = String(itemId).toLowerCase();
    return (pid === "schemes-agri" || pid === "pmfby-agri" || iid === "pmfby") || iid.startsWith("pmfby");
  }

  /**
   * PMFBY status: verify OTP (order_id) for transaction_id, then fetch policy/claim status and return in on_status.
   * Request must include context.transaction_id (from get_otp), order_id = OTP, and fulfillment tags: inquiry_type, season, year, phone.
   */
  private async handlePmfbyStatus(body: any, otp: string) {
    const transactionId = body?.context?.transaction_id;
    const baseContext = () => ({
      ...body.context,
      action: "on_status",
      timestamp: new Date().toISOString(),
      ttl: "PT10M",
    });

    if (!transactionId) {
      return {
        context: baseContext(),
        message: {
          order: {
            id: body.message?.order?.id ?? "error",
            tags: [
              {
                display: true,
                descriptor: {
                  name: "Verification Required",
                  code: "missing_transaction_id",
                  short_desc:
                    "Transaction ID is missing. Include context.transaction_id from get_otp in the request.",
                },
              },
            ],
          },
        },
      };
    }

    const fulfillment = body?.message?.order?.fulfillments?.[0];
    const tags = fulfillment?.customer?.person?.tags ?? [];
    const contact = fulfillment?.customer?.contact ?? {};
    const getTagValue = (code: string) =>
      tags.find((t: any) => t?.descriptor?.code === code)?.value;
    const phoneFromStore = this.pmfbyOtpTransactionStore.get(transactionId);
    const phoneFromTag = getTagValue("phone_number");
    const phoneFromContact = contact?.phone;
    const phone = phoneFromStore ?? phoneFromTag ?? phoneFromContact;
    const phoneStr = phone != null ? String(phone).trim() : "";

    if (!phoneStr) {
      return this.createStatusErrorResponse(
        body.context,
        "missing_phone",
        "Phone number is required. Use the same transaction_id from get_otp or send phone in fulfillment."
      );
    }

    const inquiryType = getTagValue("inquiry_type");
    const season = getTagValue("season");
    const year = getTagValue("year");
    if (!inquiryType || !season || !year) {
      return this.createStatusErrorResponse(
        body.context,
        "missing_input",
        "inquiry_type (policy_status or claim_status), season, and year are required in fulfillment customer.person.tags."
      );
    }

    try {
      const result = await this.pmfbyService.verifyOtp(phoneStr, otp);
      if (!result.verified) {
        return this.createStatusErrorResponse(
          body.context,
          "otp_verification_failed",
          result.reason ?? "OTP verification failed"
        );
      }
      this.pmfbyVerifiedTransactions.add(transactionId);

      const farmerId = await this.pmfbyService.getFarmerId(phoneStr);
      if (!farmerId) {
        return this.createStatusErrorResponse(
          body.context,
          "farmer_id_not_found",
          "Farmer ID not found for the provided mobile number"
        );
      }

      const pmfbyToken = await this.pmfbyService.getPmfbyToken();
      const formattedYear = String(year).slice(-2);
      const seasonCode =
        String(season).toLowerCase() === "kharif"
          ? "1"
          : String(season).toLowerCase() === "rabi"
            ? "2"
            : String(season).toLowerCase() === "summer"
              ? "3"
              : "";

      let mappedResponse;
      if (String(inquiryType).toLowerCase() === "policy_status") {
        const response = await this.pmfbyService.getPolicyStatus(
          farmerId,
          seasonCode,
          formattedYear,
          pmfbyToken
        );
        mappedResponse = await pmfbyPolicyGenerator(response?.data ?? response, "Policies");
      } else if (String(inquiryType).toLowerCase() === "claim_status") {
        const response = await this.pmfbyService.getClaimStatus(
          farmerId,
          seasonCode,
          String(year),
          pmfbyToken
        );
        mappedResponse = await pmfbyClaimStatusGenerator(response?.data ?? response, "Claims");
      } else {
        return this.createStatusErrorResponse(
          body.context,
          "invalid_inquiry_type",
          "inquiry_type must be policy_status or claim_status"
        );
      }

      return {
        context: baseContext(),
        message: {
          order: {
            id: body.message?.order?.id ?? transactionId,
            state: "COMPLETED",
            ...(body.message?.order?.provider && { provider: body.message.order.provider }),
            ...(body.message?.order?.items?.length && { items: body.message.order.items }),
            tags: [
              {
                display: true,
                descriptor: {
                  name: "OTP Verified",
                  code: "otp_verified",
                  short_desc: "Mobile number verified successfully. Policy/claim status below.",
                },
              },
            ],
          },
          catalog: mappedResponse,
        },
      };
    } catch (err: any) {
      const msg = err?.message ?? "PMFBY request failed";
      console.error("❌ handlePmfbyStatus error:", err);
      return this.createStatusErrorResponse(body.context, "pmfby_error", msg);
    }
  }

  private clearTempOTPStore() {
    this.tempOTPStore = {
      otp: null,
      identifier: null,
      mobileNumber: null,
      timestamp: null,
    };
  }

  private createStatusErrorResponse(
    context: any,
    code: string,
    message: string
  ) {
    return {
      context: {
        ...context,
        action: "on_status",
        timestamp: new Date().toISOString(),
        ttl: "PT10M",
      },
      message: {
        order: {
          id: "error",
          tags: [
            {
              display: true,
              descriptor: {
                name: "Error",
                code: code,
                short_desc: message,
              },
            },
          ],
        },
      },
    };
  }

  private extractBeneficiaryName(userDataResponse: string): string {
    // Extract beneficiary name from the response string
    const beneficiaryNameMatch = userDataResponse.match(
      /Beneficiary Name - (.+)/
    );
    if (beneficiaryNameMatch && beneficiaryNameMatch[1]) {
      return beneficiaryNameMatch[1].trim();
    }
    // Fallback to a default name if extraction fails
    return "Beneficiary";
  }

  private createSuccessResponse(
    context: any,
    orderId: string,
    mobileNumber: string,
    userDataResponse: string
  ) {
    return {
      context: {
        ...context,
        action: "on_status",
        timestamp: new Date().toISOString(),
        ttl: "PT10M",
      },
      message: {
        order: {
          id: orderId,
          state: "COMPLETED",
          provider: {
            id: "pm_kisan_provider",
            descriptor: {
              name: "PM Kisan Portal",
              short_desc: "PM Kisan Beneficiary Status Service",
            },
          },
          items: [
            {
              id: "pm_kisan_status",
              descriptor: {
                name: "Beneficiary Status",
                short_desc: "PM Kisan beneficiary details and payment status",
              },
            },
          ],
          fulfillments: [
            {
              customer: {
                person: { name: this.extractBeneficiaryName(userDataResponse) },
                contact: { phone: mobileNumber || "XXXXXXXXXX" },
              },
              state: {
                descriptor: {
                  name: "Status",
                  code: "completed",
                  short_desc: "OTP verified and user data retrieved",
                  long_desc: userDataResponse,
                },
                updated_at: new Date().toISOString(),
              },
            },
          ],
        },
      },
    };
  }

  private createFetchErrorResponse(
    context: any,
    orderId: string,
    mobileNumber: string,
    fetchError: any
  ) {
    return {
      context: {
        ...context,
        action: "on_status",
        timestamp: new Date().toISOString(),
        ttl: "PT10M",
      },
      message: {
        order: {
          id: orderId,
          state: "FAILED",
          provider: {
            id: "pm_kisan_provider",
            descriptor: {
              name: "PM Kisan Portal",
              short_desc: "PM Kisan Beneficiary Status Service",
            },
          },
          items: [
            {
              id: "pm_kisan_status",
              descriptor: {
                name: "Beneficiary Status",
                short_desc: "Failed to retrieve beneficiary data",
              },
            },
          ],
          fulfillments: [
            {
              customer: {
                person: { name: "Beneficiary" },
                contact: { phone: mobileNumber || "XXXXXXXXXX" },
              },
              state: {
                descriptor: {
                  name: "Error",
                  code: "fetch_user_data_failed",
                  short_desc: "Failed to retrieve beneficiary data",
                  long_desc:
                    fetchError.message ||
                    "An error occurred while fetching user data",
                },
                updated_at: new Date().toISOString(),
              },
            },
          ],
        },
      },
    };
  }

  generateFeedbackUrl(): string {
    // Generate and return a feedback URL
    // For simplicity, you can use a static URL or generate a unique URL as needed
    return "https://example.com/feedback";
  }

  async handleSubmit(description, id) {
    console.log("description", description);
    console.log("id", id);
    try {
      const courseData = await this.hasuraService.SubmitFeedback(
        description,
        id
      );
      console.log("courseData", courseData);
      return { message: "feedback submitted Successfully" };
    } catch (error) {
      return error;
    }
  }

  // Function to check if a string is a valid URL
  isValidUrl(str: string) {
    try {
      new URL(str);
      return true;
    } catch (error) {
      return false;
    }
  }

  async handlePmKisanSearch(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    const intent: any = body.message.intent;

    // destructuring the intent
    const provider = intent?.provider?.descriptor?.name;
    const query = intent?.item?.descriptor?.name;
    const tagGroup = intent?.item?.tags;
    const categoryCode = intent?.category?.descriptor?.code.toLowerCase();
    const schemeCode = intent?.item?.descriptor?.name.toLowerCase();
    const requestDomain = body.context.domain;

    const flattenedTags: any = {};
    if (tagGroup) {
      (tagGroup[0].list as any[])?.forEach((tag) => {
        flattenedTags[tag.name] = tag.value;
      });
    }
    const domain = flattenedTags?.domain !== "" ? flattenedTags?.domain : null;
    const theme = flattenedTags?.theme !== "" ? flattenedTags?.theme : null;
    const goal = flattenedTags?.goal !== "" ? flattenedTags?.goal : null;
    const competency =
      flattenedTags?.competency !== "" ? flattenedTags?.competency : null;
    const language =
      flattenedTags?.language !== "" ? flattenedTags?.language : null;
    const contentType =
      flattenedTags?.contentType !== "" ? flattenedTags?.contentType : null;

    let obj = {};
    if (flattenedTags.domain) {
      obj["domain"] = flattenedTags.domain;
    }
    if (flattenedTags?.theme) {
      obj["theme"] = flattenedTags?.theme;
    }
    if (flattenedTags?.goal) {
      obj["goal"] = flattenedTags?.goal;
    }
    if (flattenedTags?.competency) {
      obj["competency"] = flattenedTags?.competency;
    }
    if (flattenedTags?.language) {
      obj["language"] = flattenedTags?.language;
    }
    if (flattenedTags?.contentType) {
      obj["contentType"] = flattenedTags?.contentType;
    }

    try {
      // Construct the query string
      // Construct the query string
      let searchQuery = "";
      const filters = [];

      // Add category code filter if it's not empty
      if (categoryCode && categoryCode.trim() !== "") {
        filters.push(`usecase: {_ilike: "${categoryCode}"}`);
      }

      // Add scheme code filter if it's not empty
      if (schemeCode && schemeCode.trim() !== "") {
        filters.push(`scheme_id: {_ilike: "${schemeCode}"}`);
      }

      // Construct the where clause if any filters are present
      if (filters.length > 0) {
        searchQuery = `(where: { ${filters.join(", ")} }, `;
      } else {
        searchQuery = ""; // or handle case where no filters are applied
      }

      const resp = await this.hasuraService.findIcarContent(searchQuery);


      // const icarResponse: any = resp.data.icar_.Content;
      const icarResponse: any = process.env.NODE_ENV === 'dev' ? resp.data.icar_.Content : resp.data.Content;
      // console.log("icarResponse=======>>>> ", JSON.stringify(icarResponse, null, 2));
      for (let item of icarResponse) {
        if (item.icon) {
          if (!this.isValidUrl(item.icon)) {
            item.icon = await this.hasuraService.getImageUrl(item.icon);
          }
        }
      }
      let catalog;
      catalog = PmKisanIcarGenerator(icarResponse, query);

      body.context.action = "on_search";
      const courseData: any = {
        context: body.context,
        message: {
          catalog: catalog,
        },
      };


      return courseData;
    } catch (err) {
      throw new InternalServerErrorException(err.message, {
        cause: err,
      });
    }
  }

  async handlePmkisanInit(body: any) {
    // Extract registration number from customer tags
    const customerTags =
      body?.message?.order?.fulfillments?.[0]?.customer?.person?.tags;
    let registrationNumber = this.extractRegistrationNumber(customerTags);

    // Validate registration number
    if (!registrationNumber) {
      return this.createErrorResponse(
        body.context,
        "missing_registration",
        "Valid registration number is required for OTP generation"
      );
    }

    // Sanitize and validate mobile number
    const phone =
      body?.message?.order?.fulfillments?.[0]?.customer?.contact?.phone;
    const isValidPhone =
      typeof phone === "string" && /^[6-9]\d{9}$/.test(phone);

    try {
      // Generate and store OTP using registration number
      const otpResponse = await this.sendOTP(registrationNumber, "");

      if (otpResponse.status === "OK") {
        // Store registration number for later OTP verification : comment for now implement OTP later
        // this.tempOTPStore = {
        //   otp: null,
        //   identifier: registrationNumber,
        //   mobileNumber: registrationNumber,
        //   timestamp: new Date().toISOString(),
        // };

        // Build status message
        let otpMessage =
          "Request for OTP is sent. Please enter the OTP when received and Submit.";
        // if (!isValidPhone) {
        //   otpMessage += " However, the provided contact phone number is invalid and will not be used.";
        // }
        return {
          context: {
            ...body.context,
            action: "on_init",
            timestamp: new Date().toISOString(),
          },
          message: {
            order: {
              provider: { id: "NA" },
              items: [
                {
                  id: "NA",
                  tags: [
                    {
                      display: true,
                      descriptor: {
                        name: "Otp Status",
                        code: "otp_status",
                        short_desc: otpMessage,
                      },
                    },
                  ],
                },
              ],
              type: "DEFAULT",
            },
          },
        };
      } else {
        return this.createErrorResponse(
          body.context,
          "otp_error",
          otpResponse.d?.output?.Message ||
          "Failed to generate OTP. Please try again later."
        );
      }
    } catch (error) {
      console.log("ORDER_STATUS", error);
      return this.createErrorResponse(
        body.context,
        "processing_error",
        "Failed to process request. Please try again later."
      );
    }
  }

  private extractRegistrationNumber(customerTags: any[]): string | null {
    if (!customerTags || !Array.isArray(customerTags)) {
      return null;
    }

    for (const tag of customerTags) {
      if (
        tag.descriptor?.code === "reg-details" &&
        tag.list &&
        Array.isArray(tag.list)
      ) {
        for (const item of tag.list) {
          if (item.descriptor?.code === "reg-number") {
            const regNumber = String(item.value).trim();
            // Validate: should not be empty and should be alphanumeric
            if (
              regNumber &&
              regNumber.length > 0 &&
              /^[A-Z0-9]+$/i.test(regNumber)
            ) {
              return regNumber;
            }
          }
        }
      }
    }
    return null;
  }

  private createErrorResponse(context: any, code: string, message: string) {
    return {
      context: {
        ...context,
        action: "on_init",
        timestamp: new Date().toISOString(),
      },
      message: {
        order: {
          provider: { id: "NA" },
          items: [
            {
              id: "NA",
              tags: [
                {
                  display: true,
                  descriptor: {
                    name: "Error",
                    code: code,
                    short_desc: message,
                  },
                },
              ],
            },
          ],
          type: "DEFAULT",
        },
      },
    };
  }

  // Utility functions
  private titleCase(str: string): string {
    if (!str) return "";
    return str
      .toLowerCase()
      .split(" ")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");
  }

  private addOrdinalSuffix(num: number): string {
    if (num === 0) return "No";
    const j = num % 10;
    const k = num % 100;
    if (j === 1 && k !== 11) {
      return num + "st";
    }
    if (j === 2 && k !== 12) {
      return num + "nd";
    }
    if (j === 3 && k !== 13) {
      return num + "rd";
    }
    return num + "th";
  }

  private AADHAAR_GREETING_MESSAGE(
    BeneficiaryName: string,
    FatherName: string,
    DOB: string,
    Address: string,
    DateOfRegistration: string,
    LatestInstallmentPaid: number,
    Reg_No: string,
    StateName: string,
    DistrictName: string,
    SubDistrictName: string,
    VillageName: string,
    eKYC_Status: string
  ): string {
    return `Beneficiary Name - ${BeneficiaryName}
Beneficiary Location - ${StateName}, ${DistrictName}, ${SubDistrictName}, ${VillageName}
Registration Number - ${Reg_No}
Registration Date - ${format(
      new Date(DateOfRegistration),
      "M/d/yyyy h:mm:ss a"
    )}
Last Installment Status - ${LatestInstallmentPaid == 0
        ? "No"
        : this.addOrdinalSuffix(LatestInstallmentPaid)
      } Installment payment done
eKYC - ${eKYC_Status == "Y" ? "Done" : "Not Done"}`;
  }

  async getUserData(
    mobileNumber: string,
    type: string = "Ben_id"
  ): Promise<any> {
    let res: any;
    try {
      const requestData = `{\"Types\":\"${type}\",\"Values\":\"${mobileNumber}\",\"Token\":\"${process.env.PM_KISSAN_TOKEN}\"}`;
      console.log("Request data: ", requestData);
      let key = getUniqueKey();
      let encrypted_text = await encrypt(requestData, key);
      console.log("encrypted text without @: ", encrypted_text);

      let data = {
        EncryptedRequest: `${encrypted_text}@${key}`,
      };

      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: `${process.env.PM_KISAN_BASE_URL}/ChatbotUserDetails`,
        headers: {
          "Content-Type": "application/json",
        },
        data: data,
        timeout: 60000, // 10 second timeout
      };

      console.log("getUserData config:", config);
      res = await axios.request(config);
      this.logger.log("getUserData response status:", res.status);

      if (res.status >= 200 && res.status < 300) {
        res = await res.data;
        console.log("getUserData raw response:", res);

        if (res.d && res.d.output) {
          let decryptedData: any = await decryptRequest(res.d.output, key);
          console.log("Response of getUserData", res);
          console.log("decrypted data(from getUserData): ", decryptedData);

          try {
            res.d.output = JSON.parse(decryptedData);
            
            res["status"] = res.d.output.Rsponce != "False" ? "OK" : "NOT_OK";
          } catch (parseError) {
            console.error("Error parsing decrypted data:", parseError);
            res.d.output = {
              Rsponce: "False",
              Message: "Error parsing response",
            };
            res["status"] = "NOT_OK";
          }
        } else {
          console.error("Invalid response structure:", res);
          res = {
            d: {
              output: {
                Rsponce: "False",
                Message: "Invalid response structure",
              },
            },
            status: "NOT_OK",
          };
        }
      } else {
        console.error("getUserData HTTP error:", res.status);
        res = {
          d: {
            output: {
              Rsponce: "False",
              Message: "HTTP request failed",
            },
          },
          status: "NOT_OK",
        };
      }
    } catch (error) {
      console.error("getUserData error:", error.message);
      res = {
        d: {
          output: {
            Rsponce: "False",
            Message: "Unable to get user details",
          },
        },
        status: "NOT_OK",
      };
    }
    return res;
  }

  async fetchUserData(context: any, event: any): Promise<string> {
    this.logger.log("Fetch user data");
    this.logger.log("Current queryType:", context.queryType);
    const userIdentifier = `${context.userAadhaarNumber}${context.lastAadhaarDigits}`;
    let res;
    let type = "Ben_id";

    // Comment out other cases and keep only Ben_id
    if (/^[6-9]\d{9}$/.test(userIdentifier)) {
      type = "Mobile";
      res = await this.getUserData(userIdentifier, "Mobile");
    // } else if (
    //   userIdentifier.length == 14 &&
    //   /^[6-9]\d{9}$/.test(userIdentifier.substring(0, 10))
    // ) {
    //   type = "MobileAadhar";
    //   res = await this.getUserData(userIdentifier, "MobileAadhar");
    } else if (userIdentifier.length == 12 && /^\d+$/.test(userIdentifier)) {
      type = "Aadhar";
      res = await this.getUserData(userIdentifier, "Aadhar");
    } else if (userIdentifier.length == 11) {
      type = "Ben_id";
      res = await this.getUserData(userIdentifier, "Ben_id");
    } else {
      return Promise.reject(
        new Error(
          "Please enter a valid Beneficiary ID/Aadhaar Number/Phone number"
        )
      );
    }

    // Always use Ben_id
    // res = await this.getUserData(userIdentifier, type);

    if (res.d.output.Message == "Unable to get user details") {
      // Instead of throwing an error, return a formatted error message
      return `=== PM KISAN BENEFICIARY STATUS ===\n\nError: Unable to retrieve beneficiary details. Please check your registration number and try again.\n\n=== PAYMENT STATUS & ISSUES ===\n\nNo payment information available due to retrieval error.`;
    }

    let userDetails = this.AADHAAR_GREETING_MESSAGE(
      this.titleCase(res.d.output["BeneficiaryName"]),
      this.titleCase(res.d.output["FatherName"]),
      res.d.output["DOB"],
      res.d.output["Address"],
      res.d.output["DateOfRegistration"],
      res.d.output["LatestInstallmentPaid"],
      res.d.output["Reg_No"],
      this.titleCase(res.d.output["StateName"]),
      this.titleCase(res.d.output["DistrictName"]),
      this.titleCase(res.d.output["SubDistrictName"]),
      this.titleCase(res.d.output["VillageName"]),
      res.d.output["eKYC_Status"]
    );

    this.logger.log("ChatbotBeneficiaryStatus");
    this.logger.log("using...", userIdentifier, type);
    let userErrors = [];

    try {
      var token = getUniqueKey();
      let requestData = `{\"Types\":\"${type}\",\"Values\":\"${userIdentifier}\",\"Token\":\"${process.env.PM_KISSAN_TOKEN}\"}`;

      let encrypted_text = await encrypt(requestData, token);
      let data = {
        EncryptedRequest: `${encrypted_text}@${token}`,
      };

      let config = {
        method: "post",
        maxBodyLength: Infinity,
        url: `${process.env.PM_KISAN_BASE_URL}/ChatbotBeneficiaryStatus`,
        headers: {
          "Content-Type": "application/json",
        },
        data: data,
      };

      this.logger.log("In fetchUserData:", JSON.stringify(config));
      let errors: any = await axios.request(config);
      errors = await errors.data;
      this.logger.log("related issues", JSON.stringify(errors));

      let decryptedData: any = await decryptRequest(errors.d.output, token);

      // Parse the decrypted data to get the actual API response
      try {
        errors = JSON.parse(decryptedData);
        this.logger.log("Decrypted API response:", JSON.stringify(errors));
      } catch (parseError) {
        this.logger.error("Error parsing decrypted data:", parseError);
        // Fallback to original response if parsing fails
        errors = {
          Rsponce: "False",
          Message: "Error parsing API response",
        };
      }

      this.logger.log("Response from FetchUserdata: ", JSON.stringify(errors));

      if (errors.Rsponce == "True") {
        const queryType =
          typeof context.queryType === "object"
            ? context.queryType.class
            : context.queryType;

        Object.entries(errors).forEach(([key, value]) => {
          if (key != "Rsponce" && key != "Message") {
            if (
              value &&
              PMKissanProtalErrors[`${value}`] &&
              PMKissanProtalErrors[`${value}`]["types"].indexOf(queryType) != -1
            ) {
              this.logger.log(`ERRORVALUE: ${key} ${value}`);
              userErrors.push(
                PMKissanProtalErrors[`${value}`]["text"].replace(
                  "{{farmer_name}}",
                  this.titleCase(res.d.output["BeneficiaryName"])
                )
              );
            }
          }
        });
      }

      if (!userErrors.length) {
        userErrors.push(
          PMKissanProtalErrors["No Errors"]["text"]
            .replace(
              "{{farmer_name}}",
              this.titleCase(res.d.output["BeneficiaryName"])
            )
            .replace(
              "{{latest_installment_paid}}",
              res.d.output["LatestInstallmentPaid"]
            )
            .replace(
              "{{Reg_Date (DD-MM-YYYY)}}",
              format(new Date(res.d.output["DateOfRegistration"]), "dd-MM-yyyy")
            )
        );
      }
    } catch (error) {
      this.logger.error("ChatbotBeneficiaryStatus error", error);
    }

    return `=== PM KISAN BENEFICIARY STATUS ===\n\n${userDetails}\n\n=== PAYMENT STATUS & ISSUES ===\n\n${userErrors.join(
      "\n"
    )}`;
  }
  /**
   * Build PMFBY on_init response message (PMISAN structure unchanged).
   */
  private buildPmfbyOnInitMessage(
    body: any,
    code: string,
    name: string,
    short_desc: string,
    type?: string
  ) {
    const message: any = {
      order: {
        provider: {
          id: body?.message?.order?.provider?.id || "NA",
        },
        items: [
          {
            id: body?.message?.order?.items?.[0]?.id || "NA",
            tags: [
              {
                display: true,
                descriptor: { name, code, short_desc },
              },
            ],
          },
        ],
      },
    };
    if (type) message.order.type = type;
    return message;
  }

  public async handlePmfbyInit(body: any) {
    const fulfillment = body?.message?.order?.fulfillments?.[0];
    const tags = fulfillment?.customer?.person?.tags || [];
    const contact = fulfillment?.customer?.contact || {};
    const transactionId = body?.context?.transaction_id;

    const getTagValue = (code: string) =>
      tags.find((t: any) => t?.descriptor?.code === code)?.value;

    const requestType = getTagValue("request_type");
    const phoneFromTag = getTagValue("phone_number");
    const phoneFromContact = contact?.phone;
    const phone = phoneFromTag ?? phoneFromContact;
    const otpRaw = getTagValue("requested_otp") ?? contact?.otp;

    const baseResponse = () => ({
      context: {
        ...body.context,
        action: "on_init",
        timestamp: new Date().toISOString(),
      },
    });

    if (!requestType || !phone) {
      return {
        ...baseResponse(),
        message: this.buildPmfbyOnInitMessage(
          body,
          "missing_input",
          "Missing Input",
          !requestType
            ? "request_type must be get_otp. Phone number is required."
            : "Phone number is required for PMFBY OTP flow"
        ),
      };
    }

    const phoneStr = String(phone).trim();
    const requestTypeLower = String(requestType).toLowerCase().trim();

    // request_type = get_otp -> send OTP (OTP field not mandatory)
    if (requestTypeLower === "get_otp") {
      try {
        const result = await this.pmfbyService.getOtp(phoneStr);
        if (transactionId) this.pmfbyOtpTransactionStore.set(transactionId, phoneStr);
        return {
          ...baseResponse(),
          message: this.buildPmfbyOnInitMessage(
            body,
            "otp_sent",
            "OTP Sent",
            result.message ?? "OTP sent successfully"
          ),
        };
      } catch (err: any) {
        const res = err?.getResponse?.() ?? err?.response?.data;
        const msg =
          (typeof res === "object" && res?.message) ||
          err?.message ||
          "Failed to send OTP";
        return {
          ...baseResponse(),
          message: this.buildPmfbyOnInitMessage(
            body,
            "otp_send_failed",
            "Error",
            msg
          ),
        };
      }
    }

    // verify_otp is no longer supported on init; use POST /mobility/status
    if (requestTypeLower === "verify_otp") {
      return {
        ...baseResponse(),
        message: this.buildPmfbyOnInitMessage(
          body,
          "use_status_api",
          "Use Status API",
          "OTP verification and policy/claim status are done via POST /mobility/status. Send context.transaction_id (same as get_otp), order_id = OTP, and fulfillment tags: inquiry_type (policy_status or claim_status), season, year, phone_number."
        ),
      };
    }

    return {
      ...baseResponse(),
      message: this.buildPmfbyOnInitMessage(
        body,
        "invalid_request_type",
        "Error",
        "request_type must be get_otp"
      ),
    };

    // ---------- COMMENTED OUT: previous PMFBY init (inquiryType / season / year / farmerId / policy or claim status) ----------
    // const inquiryType =
    //   body?.message?.order?.fulfillments?.[0]?.customer?.person?.tags?.find(
    //     (tag) => tag?.descriptor?.code === "inquiry_type"
    //   )?.value;
    // const payload = body?.message?.order;
    // const tags = payload?.fulfillments?.[0]?.customer?.person?.tags || [];
    // const season = tags.find((tag) => tag.descriptor?.code === "season")?.value;
    // const year = tags.find((tag) => tag.descriptor?.code === "year")?.value;
    // const mobileNumber = payload?.fulfillments?.[0]?.customer?.contact?.phone;
    // if (!inquiryType || !season || !year) { return { context: {...}, message: { order: { provider, items: [ tags: missing_input ] } } }; }
    // const farmerId = await this.pmfbyService.getFarmerId(mobileNumber);
    // if (!farmerId) { return { context: {...}, message: { order: { ..., type: "DEFAULT", tags: farmer_id_not_found } }; }
    // const pmfbyToken = await this.pmfbyService.getPmfbyToken();
    // if (inquiryType === "policy_status") { response = getPolicyStatus(...); mappedResponse = pmfbyPolicyGenerator(...); }
    // else if (inquiryType === "claim_status") { response = getClaimStatus(...); mappedResponse = pmfbyClaimStatusGenerator(...); }
    // return { context: {...}, message: mappedResponse };
  }

  async weatherforecastSearch(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    console.log("Weather forecast search initiated");
    return this.weatherForecastService.weatherforecastSearch(body);
  }


  async masuamGramaWeatherForecastSearch(body: {
    context: components["schemas"]["Context"];
    message: { intent: components["schemas"]["Intent"] };
  }) {
    console.log("Mausamgram Weather forecast search initiated");
    return this.weatherForecastService.mausamgramWeatherforecastSearch(body);
  }


  /**
   * PMFBY search: allowed only when transaction_id has completed OTP verification (via /status with OTP, or legacy init verify_otp).
   * Supports both search payload (message.fulfillments) and order-style (message.order.fulfillments).
   */
  async handlePmfbySearch(body: any) {
    console.log("[PMFBY Search] Step 0: Request received", {
      transaction_id: body?.context?.transaction_id,
      message_id: body?.context?.message_id,
    });

    const transactionId = body?.context?.transaction_id;

    const baseSearchContext = () => ({
      ...body.context,
      action: "on_search",
      timestamp: new Date().toISOString(),
    });

    const providerId = body?.message?.order?.provider?.id || "unknow provider id";
    const itemId = body?.message?.order?.items?.[0]?.id || body?.message?.intent?.category?.descriptor?.code || "pmfby";

    const buildSearchError = (code: string, name: string, short_desc: string) => ({
      context: baseSearchContext(),
      message: {
        order: {
          provider: { id: providerId },
          items: [
            {
              id: itemId,
              tags: [
                { display: true, descriptor: { name, code, short_desc } },
              ],
            },
          ],
        },
      },
    });

    console.log("[PMFBY Search] Step 1: Checking OTP verification for transaction_id", transactionId);
    if (!transactionId || !this.pmfbyVerifiedTransactions.has(transactionId)) {
      const transactionMismatchMessage = !transactionId
        ? "Transaction ID is missing. Include context.transaction_id in the request."
        : `Transaction ID "${transactionId}" does not match a verified session. Complete get_otp via init, then verify OTP and get status via POST /mobility/status using the same transaction_id.`;
      console.log("[PMFBY Search] Step 1 FAILED: Transaction not verified", {
        transaction_id: transactionId,
        has_transaction_id: !!transactionId,
        is_verified: transactionId ? this.pmfbyVerifiedTransactions.has(transactionId) : false,
      });
      return buildSearchError(
        "otp_not_verified",
        "Verification Required",
        transactionMismatchMessage
      );
    }
    console.log("[PMFBY Search] Step 1 OK: Transaction verified");

    const bodyKeys = body && typeof body === "object" ? Object.keys(body) : [];
    const unwrapped = body?.request ?? body?.payload ?? body;
    console.log("[PMFBY Search] Step 2: Body shape", {
      top_level_keys: bodyKeys,
      has_fulfillments_root: Array.isArray(unwrapped?.fulfillments) && unwrapped.fulfillments.length > 0,
      has_message_fulfillments: Array.isArray(unwrapped?.message?.fulfillments) && unwrapped.message.fulfillments.length > 0,
      has_message_order_fulfillments: Array.isArray(unwrapped?.message?.order?.fulfillments) && unwrapped.message?.order?.fulfillments?.length > 0,
    });

    const fulfillment =
      unwrapped?.fulfillments?.[0] ??
      unwrapped?.message?.fulfillments?.[0] ??
      unwrapped?.message?.order?.fulfillments?.[0];

    const tags =
      fulfillment?.customer?.person?.tags ??
      fulfillment?.person?.tags ??
      (Array.isArray(fulfillment?.tags) ? fulfillment.tags : []);
    const inquiryType = tags.find((tag: any) => tag?.descriptor?.code === "inquiry_type")?.value;
    const season = tags.find((tag: any) => tag?.descriptor?.code === "season")?.value;
    const year = tags.find((tag: any) => tag?.descriptor?.code === "year")?.value;
    const mobileNumber =
      fulfillment?.customer?.contact?.phone ?? fulfillment?.contact?.phone;

    console.log("[PMFBY Search] Step 2: Parsed fulfillment and tags", {
      fulfillment_source: fulfillment
        ? unwrapped?.fulfillments?.[0] === fulfillment
          ? "fulfillments[0]"
          : unwrapped?.message?.fulfillments?.[0] === fulfillment
            ? "message.fulfillments[0]"
            : "message.order.fulfillments[0]"
        : "none",
      inquiry_type: inquiryType,
      season,
      year,
      mobile: mobileNumber ? `${String(mobileNumber).slice(0, 4)}****${String(mobileNumber).slice(-2)}` : undefined,
      tags_count: tags?.length,
      tag_codes: tags?.map((t: any) => t?.descriptor?.code).filter(Boolean),
    });

    if (!inquiryType || !season || !year) {
      console.log("[PMFBY Search] Step 2 FAILED: Missing required fields", {
        has_inquiryType: !!inquiryType,
        has_season: !!season,
        has_year: !!year,
      });
      return buildSearchError(
        "missing_input",
        "Missing Input",
        `${!inquiryType ? "inquiryType" : !season ? "season" : "year"} is required for PMFBY service`
      );
    }
    console.log("[PMFBY Search] Step 2 OK: All required fields present");

    console.log("[PMFBY Search] Step 3: Fetching farmer ID for mobile");
    const farmerId = await this.pmfbyService.getFarmerId(mobileNumber);
    console.log("[PMFBY Search] Step 3: Farmer ID result", { farmerId: farmerId || "(not found)" });
    if (!farmerId) {
      console.log("[PMFBY Search] Step 3 FAILED: Farmer ID not found");
      return buildSearchError(
        "farmer_id_not_found",
        "Error",
        "Farmer ID not found for the provided mobile number"
      );
    }
    console.log("[PMFBY Search] Step 3 OK: Farmer ID resolved");

    console.log("[PMFBY Search] Step 4: Getting PMFBY auth token");
    const pmfbyToken = await this.pmfbyService.getPmfbyToken();
    console.log("[PMFBY Search] Step 4 OK: Token acquired", { token_preview: pmfbyToken ? `${pmfbyToken.slice(0, 8)}...` : "(none)" });

    const formattedYear = String(year).slice(-2);
    const seasonCode =
      String(season).toLowerCase() === "kharif"
        ? "1"
        : String(season).toLowerCase() === "rabi"
          ? "2"
          : String(season).toLowerCase() === "summer"
            ? "3"
            : "";
    console.log("[PMFBY Search] Step 5: Resolved season/year", { seasonCode, formattedYear, inquiryType });

    let mappedResponse;
    try {
      if (String(inquiryType).toLowerCase() === "policy_status") {
        console.log("[PMFBY Search] Step 6: Fetching policy status", { farmerId, seasonCode, formattedYear });
        const response = await this.pmfbyService.getPolicyStatus(
          farmerId,
          seasonCode,
          formattedYear,
          pmfbyToken
        );
        mappedResponse = await pmfbyPolicyGenerator(response?.data ?? response, "Policies");
        console.log("[PMFBY Search] Step 6 OK: Policy data mapped");
      } else if (String(inquiryType).toLowerCase() === "claim_status") {
        console.log("[PMFBY Search] Step 6: Fetching claim status", { farmerId, seasonCode, year });
        const response = await this.pmfbyService.getClaimStatus(
          farmerId,
          seasonCode,
          String(year),
          pmfbyToken
        );
        mappedResponse = await pmfbyClaimStatusGenerator(response?.data ?? response, "Claims");
        console.log("[PMFBY Search] Step 6 OK: Claim data mapped");
      } else {
        console.log("[PMFBY Search] Step 6 FAILED: Invalid inquiry_type", { inquiryType });
        return buildSearchError(
          "invalid_inquiry_type",
          "Error",
          "inquiry_type must be policy_status or claim_status"
        );
      }
    } catch (err: any) {
      console.log("[PMFBY Search] Step 6 FAILED: PMFBY API error", { message: err?.message, stack: err?.stack?.split("\n")?.[0] });
      return buildSearchError(
        "pmfby_error",
        "Error",
        err?.message || "Failed to fetch PMFBY data"
      );
    }

    console.log("[PMFBY Search] Step 7: Returning on_search catalog success");
    return {
      context: baseSearchContext(),
      message: { catalog: mappedResponse },
    };
  }

  async mandiSearch(body: any) {
    return this.mandiService.mandiSearch(body);
  }
}
