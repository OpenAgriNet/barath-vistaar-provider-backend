import {
  Controller,
  Get,
  Post,
  UseGuards,
  Body,
  Render,
  Res,
  Req,
  Param,
  Request,
  Response,
  HttpException,
  HttpStatus,
} from "@nestjs/common";
import { AuthGuard } from "@nestjs/passport";
import { AppService } from "./app.service";
import { AuthService } from "./auth/auth.service";
import { firstValueFrom } from "rxjs";
import { HttpService } from "@nestjs/axios";

@Controller("")
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly authService: AuthService,
    private readonly httpService: HttpService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  //dsep
  @Post("dsep/search")
  getContentFromIcar(@Body() body: any) {
    console.log("search api calling");
    return this.appService.handleSearch(body);
    //return this.appService.getCoursesFromFln(body);
  }

  @Post("dsep/select")
  selectCourse(@Body() body: any) {
    console.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("dsep/init")
  initCourse(@Body() body: any) {
    console.log("init api calling");
    return this.appService.handleInit(body);
  }

  @Post("dsep/confirm")
  confirmCourse(@Body() body: any) {
    console.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("dsep/rating")
  giveRating(@Body() body: any) {
    console.log("rating api calling");
    return this.appService.handleRating(body);
  }

  //mobility search endpoint
  @Post("mobility/search")
  async getContentFromIcar1(@Body() body: any) {
    console.log("search api calling");

    const categoryName = body?.message?.intent?.category?.descriptor?.name;
    console.log("categoryName", categoryName);
    const categoryCode =
      body?.message?.intent?.category?.descriptor?.code?.toLowerCase();
    console.log("categoryCode", categoryCode);
    const categoryNameLower = categoryName?.toLowerCase();
    console.log("categoryNameLower", categoryNameLower);
    // Determine the category type for switch case
    let categoryType: string;

    if (categoryName === "knowledge-advisory") {
      categoryType = "knowledge-advisory";
    } else if (categoryName === "Weather-Forecast") {
      categoryType = "weather-forecast";
    } else if (categoryName === "Weather-Forecast-Mausamgram") {
      categoryType = "weather-forecast-mausamgram";
    } else if (
      categoryCode === "schemes-agri" ||
      categoryNameLower === "schemes-agri"
    ) {
      categoryType = "schemes-agri";
    } else if (
      categoryCode === "icar-schemes" ||
      categoryNameLower === "icar-schemes"
    ) {
      categoryType = "icar-schemes";
    } else if (
      categoryCode === "pmfby" ||
      categoryNameLower === "pmfby" ||
      categoryCode?.startsWith("pmfby")
    ) {
      categoryType = "pmfby";
    } else if (body?.message?.order?.provider?.id === "gfr-agri") {
      console.log("INSIDE GFR SEARCH...");
      return this.appService.fetchGFRDetails(body);
    } else if (categoryCode === "price-discovery") {
      const itemCode =
        body?.message?.intent?.item?.descriptor?.code?.toLowerCase();
      categoryType = itemCode === "mandi" ? "mandi" : "unknown";
    } else {
      categoryType = "unknown";
    }

    switch (categoryType) {
      case "knowledge-advisory":
        console.log("Inside Knowledge Advisory search");
        return this.appService.searchForIntentQuery(body);

      case "weather-forecast":
        console.log("Inside Weather Forecast search");
        return this.appService.weatherforecastSearch(body);

      case "weather-forecast-mausamgram":
        console.log("Inside Weather Forecast search from mausamgram");
        return this.appService.masuamGramaWeatherForecastSearch(body);

      case "schemes-agri":
        console.log("Inside schemes-agri search");
        return this.appService.handlePmKisanSearch(body);

      case "icar-schemes":
        console.log("Inside Icar search");
        return this.appService.handleSearch(body);

      case "mandi":
        console.log("Inside Mandi (price-discovery) search");
        return this.appService.mandiSearch(body);

      case "pmfby":
        console.log("Inside PMFBY search");
        return await this.appService.handlePmfbySearch(body);

      default:
        // Handle unknown category or return appropriate response
        return this.appService.searchForIntentQuery(body);
    }
  }

  @Post("mobility/select")
  selectCourse1(@Body() body: any) {
    console.log("select api calling");
    return this.appService.handleSelect(body);
  }

  @Post("mobility/init")
  async initCourse1(@Body() body: any) {
    console.log("init api calling");
    if (
      body?.message?.order?.provider?.id?.toLowerCase() == "pmfby-agri" &&
      body?.message?.order?.items?.[0]?.id?.toLowerCase() == "pmfby"
    ) {
      console.log("INSIDE PMFBY INIT...");
      return this.appService.handlePmfbyInit(body);
    } else if (body?.message?.order?.provider?.id === "shc-discovery") {
      try {
        // Fetch soil health data

        let soilHeallthCardResponse =
          await this.appService.fetchAndMapSoilHealthCard(body);

        // Pass the first item to handleStatusForSHC for mapping
        return await this.appService.handleStatusForSHC(
          soilHeallthCardResponse,
          body,
        );
      } catch (error) {
        throw new HttpException(
          `Failed to process soil health card: ${error.message}`,
          error.status || HttpStatus.INTERNAL_SERVER_ERROR,
        );
      }
    } else if (body?.message?.order) {
      console.log("Inside pmkisan init...");
      return this.appService.handlePmkisanInit(body);
    } else {
      return this.appService.handleInit(body);
    }
  }

  @Post("mobility/confirm")
  confirmCourse1(@Body() body: any) {
    console.log("confirm api calling");
    return this.appService.handleConfirm(body);
  }

  @Post("mobility/rating")
  giveRating1(@Body() body: any) {
    console.log("rating api calling");
    return this.appService.handleRating(body);
  }

  @Post("mobility/status")
  async handleStatus(@Body() body: any) {
    console.log("status api calling");

    return this.appService.handleStatus(body);
  }

  /** Proxy for Vistaar/PMKISAN API (avoids CORS when using vistaar-tester Next.js app from browser) */
  @Post("vistaar-proxy")
  async vistaarProxy(
    @Body() body: { operation: string; EncryptedRequest: string },
  ) {
    const base =
      process.env.PM_KISAN_BASE_URL ||
      process.env.PM_KISAN_BASE_OTP_URL ||
      "https://exlink.pmkisan.gov.in/services/chatbotservice.asmx";
    const paths: Record<string, string> = {
      sendOtp: "/ChatbotOTP",
      verifyOtp: "/ChatbotOTPVerified",
      getUser: "/ChatbotUserDetails",
    };
    const path = paths[body?.operation];
    if (!path || !body?.EncryptedRequest) {
      throw new HttpException(
        "Missing operation or EncryptedRequest",
        HttpStatus.BAD_REQUEST,
      );
    }
    const url = `${base.replace(/\/$/, "")}${path}`;
    const res = await firstValueFrom(
      this.httpService.post(
        url,
        { EncryptedRequest: body.EncryptedRequest },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 15000,
          responseType: "text",
        },
      ),
    ).catch((err) => {
      const status = err.response?.status || HttpStatus.BAD_GATEWAY;
      const msg = err.response?.data ?? err.message;
      throw new HttpException(msg, status);
    });
    return { data: res.data };
  }

  @Get("feedback/:id")
  @Render("feedback")
  getFeedbackForm(@Param("id") id: string) {
    return { id };
  }

  @Post("/submit-feedback/:id")
  submitFeedback(
    @Body("description") description: string,
    @Param("id") id: string,
    @Request() req: any,
  ) {
    console.log("description", description);
    console.log("id", id);

    const referer = req.get("Referer");
    console.log("Referer", referer);

    //return this.appService.handleSubmit(description, id);

    // Check if the referer is not empty and belongs to your allowed domain
    if (
      (referer && referer.includes("https://vistaar.tekdinext.com/")) ||
      referer.includes("https://oan.tekdinext.com/")
    ) {
      // Allow access to the feedback form
      return this.appService.handleSubmit(description, id);
    } else {
      // Deny access if not loaded within the iframe
      // res.status(403).send('Access denied. This page can only be loaded within an iframe.');
      throw new HttpException(
        "Access denied. This page can only be loaded within an iframe.",
        HttpStatus.FORBIDDEN,
      );
    }
  }
}
